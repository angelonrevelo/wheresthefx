import { useEffect, useRef, useState } from "react";
import L, { Map as LeafletMap, LayerGroup } from "leaflet";
import type { EventFilter } from "@/type/filter";
import "leaflet/dist/leaflet.css";
import { type LocationMarker } from "@/util/cluster";
import { createMiddleFingerIcon } from "@/util/markerIcon";
import { EventPopup, EventSidePanel } from "@/component/event";
import { useEventMarkers } from "@/hook/useEventMarkers";
import { useIsMobile } from "@/hook/use-mobile";

interface EventMapProps {
  filter?: EventFilter;
  searchQuery?: string;
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
      center: [14.651676537238625, 121.04921119789635],
      zoom: 13,
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

  // Center map — geolocation first, fallback to first marker. Run once.
  useEffect(() => {
    if (hasCenteredRef.current) return;

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const center: [number, number] = [position.coords.latitude, position.coords.longitude];
          setUserLocation(center);
          mapRef.current?.setView(center, 12);
          hasCenteredRef.current = true;
        },
        () => {
          // Geolocation denied — use first marker as fallback
          if (markers.length > 0) {
            mapRef.current?.setView([markers[0].lat, markers[0].lng], 12);
            hasCenteredRef.current = true;
          }
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } else if (markers.length > 0) {
      mapRef.current?.setView([markers[0].lat, markers[0].lng], 12);
      hasCenteredRef.current = true;
    }
  }, [markers]);

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
        icon: createMiddleFingerIcon(m.event.length, primaryCategory),
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
