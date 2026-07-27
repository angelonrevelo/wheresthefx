import { useEffect, useRef, useState } from "react";
import L, { Map as LeafletMap, LayerGroup } from "leaflet";
import type { EventFilter } from "@/type/filter";
import "leaflet/dist/leaflet.css";
import { type LocationMarker } from "@/util/cluster";
import { createEventMarkerIcon } from "@/util/markerIcon";
import { EventPopup, EventSidePanel } from "@/component/event";
import { useEventMarkers } from "@/hook/useEventMarkers";
import { useIsMobile } from "@/hook/use-mobile";

interface EventMapProps {
  filter?: EventFilter;
  searchQuery?: string;
}

/** Opening frame before the events arrive and the map fits to them. */
const METRO_MANILA_CENTER: [number, number] = [14.5764, 121.0351];

/** Share of markers trimmed from each edge before framing. */
const OUTLIER_TRIM = 0.05;

/** Below this many markers, every one of them is the story. */
const MIN_TO_TRIM = 12;

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

/**
 * Bounds covering the bulk of the markers, ignoring far-flung ones.
 *
 * Percentiles rather than a hardcoded Metro Manila box: the box would be
 * wrong the day the product covers Cebu, and would quietly frame an empty
 * area if a filter left nothing inside it.
 */
function coreBounds(markerList: { lat: number; lng: number }[]): L.LatLngBounds {
  if (markerList.length < MIN_TO_TRIM) {
    return L.latLngBounds(markerList.map(m => [m.lat, m.lng] as [number, number]));
  }

  const latList = markerList.map(m => m.lat).sort((a, b) => a - b);
  const lngList = markerList.map(m => m.lng).sort((a, b) => a - b);

  return L.latLngBounds(
    [percentile(latList, OUTLIER_TRIM), percentile(lngList, OUTLIER_TRIM)],
    [percentile(latList, 1 - OUTLIER_TRIM), percentile(lngList, 1 - OUTLIER_TRIM)],
  );
}

export function EventMap({ filter, searchQuery }: EventMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersLayerRef = useRef<LayerGroup | null>(null);
  const userLocationMarkerRef = useRef<L.Marker | null>(null);
  const hasCenteredRef = useRef(false);

  const [selectedMarker, setSelectedMarker] = useState<LocationMarker | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  const isMobile = useIsMobile();
  const isDesktop = !isMobile;

  const { data: markers = [] } = useEventMarkers({
    ...filter,
    searchQuery,
  });

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      // A first frame before the events load. It is immediately replaced
      // by a fit to the actual data — the map exists to show where events
      // are, so it should not open somewhere they mostly are not.
      center: METRO_MANILA_CENTER,
      zoom: 11,
      zoomControl: false,
      attributionControl: false,
      minZoom: 3,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1.0,
      zoomAnimation: true,
      zoomAnimationThreshold: 4,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
      inertiaDeceleration: 3000,
      inertiaMaxSpeed: Infinity,
      worldCopyJump: false,
      zoomSnap: 1,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 60,
      wheelDebounceTime: 40,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      crossOrigin: true,
      updateWhenZooming: true,
      updateWhenIdle: false,
      keepBuffer: 3,
      maxNativeZoom: 19,
      maxZoom: 19,
      className: "eventmap-tiles",
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  // Frame the events. Runs once, when they first arrive.
  //
  // This used to open on a hardcoded Quezon City point at zoom 13, and
  // fall back to `markers[0]` — whichever event happened to be first in
  // the response. Either way most of the map's own data sat off-screen:
  // the densest areas are Poblacion, BGC and Makati, well south of that
  // centre.
  //
  // Fitting to every marker is the other failure. The watchlist carries a
  // few genuinely provincial events — Cebu, Angeles — and one of those
  // pulls the frame out to the whole archipelago, leaving the Metro
  // Manila cluster a few pixels across. The middle of the distribution is
  // what the map is for, so outliers are trimmed before fitting.
  useEffect(() => {
    if (hasCenteredRef.current || !mapRef.current || markers.length === 0) return;

    mapRef.current.fitBounds(coreBounds(markers), {
      padding: [56, 56],
      // Without a ceiling a single event fills the screen at street level.
      maxZoom: 15,
    });
    hasCenteredRef.current = true;
  }, [markers]);

  // The user's own position is a marker, not a reason to move the view.
  // Recentring on it hid every event for anyone outside Metro Manila, and
  // for anyone who simply denied the prompt it left the map wherever the
  // hardcoded centre happened to be.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      position => setUserLocation([position.coords.latitude, position.coords.longitude]),
      () => undefined,
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
    );
  }, []);

  // User location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;

    userLocationMarkerRef.current?.remove();

    const userIcon = L.divIcon({
      html: '<div class="user-location-marker"></div>',
      className: "",
      iconSize: [8, 8],
      iconAnchor: [4, 4],
    });

    const marker = L.marker(userLocation, {
      icon: userIcon,
      zIndexOffset: 1000,
    }).addTo(map);

    userLocationMarkerRef.current = marker;

    return () => {
      userLocationMarkerRef.current?.remove();
    };
  }, [userLocation]);

  // Render markers
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    markers.forEach((m) => {
      const primaryCategory = typeof m.event[0]?.category === 'string'
        ? m.event[0].category
        : 'other';

      const marker = L.marker([m.lat, m.lng], {
        icon: createEventMarkerIcon(m.event.length, primaryCategory),
      });
      marker.on("click", () => setSelectedMarker(m));
      marker.addTo(layer);
    });
  }, [markers]);

  return (
    <>
      <div ref={containerRef} className="fixed inset-0 w-full h-screen z-[var(--z-map)] bg-[#1a1a1f]" />

      {selectedMarker && (
        isDesktop ? (
          <EventSidePanel event={selectedMarker.event} onClose={() => setSelectedMarker(null)} />
        ) : (
          <EventPopup event={selectedMarker.event} onClose={() => setSelectedMarker(null)} />
        )
      )}
    </>
  );
}
