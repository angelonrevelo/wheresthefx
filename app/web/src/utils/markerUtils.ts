import L from "leaflet";
import markerIcon from "@/assets/middle-finger-marker.png";
import { getCategoryFilter } from "@/constants/categoryColors";

export interface LocationMarker {
  lat: number;
  lng: number;
  eventCount: number;
  events: any[];
}

// Marker dimensions (match w-8 h-10 => 32x40)
const ICON_W = 32;
const ICON_H = 40;

// Coordinates for the center of the palm in the image (px from top-left)
const PALM_X = 13.5; // horizontal center
const PALM_Y = 14; // slightly above vertical center = palm area

export function createMiddleFingerIcon(count: number, category: string = 'other'): L.DivIcon {
  const hasCount = count > 1;
  const filter = getCategoryFilter(category);

  const iconHtml = `
    <div class="relative select-none" style="width:${ICON_W}px;height:${ICON_H}px">
      <img
        src="${markerIcon}"
        alt="Event marker"
        class="absolute inset-0 w-full h-full block pointer-events-none"
        style="filter: ${filter}; transform: rotate(180deg);"
        aria-hidden="true"
      />
      ${
        hasCount
          ? `
        <span
          class="absolute leading-none text-white font-semibold"
          style="
            left:${PALM_X}px;
            top:${PALM_Y}px;
            transform:translate(-50%,-50%);
            font-size:12px;
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji';
            pointer-events:none;
          "
        >${count}</span>
      `
          : ""
      }
    </div>
  `;

  return L.divIcon({
    html: iconHtml,
    className: "custom-marker", // keep this if you want to target the wrapper in CSS
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H - 2], // anchor near the (rotated) tip; adjust if needed
    popupAnchor: [0, -ICON_H + 6],
  });
}

// Haversine formula to calculate distance between two lat/lng points in meters
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Group events by proximity (default 100m radius)
export function groupEventsByProximity(events: any[], radiusMeters: number = 100): LocationMarker[] {
  const clusters: LocationMarker[] = [];

  events.forEach((event) => {
    if (!event.location_lat || !event.location_lng) return;

    const eventLat = parseFloat(event.location_lat);
    const eventLng = parseFloat(event.location_lng);

    // Find nearest cluster within radius
    let nearestCluster: LocationMarker | null = null;
    let minDistance = Infinity;

    for (const cluster of clusters) {
      const distance = calculateDistance(cluster.lat, cluster.lng, eventLat, eventLng);
      if (distance <= radiusMeters && distance < minDistance) {
        minDistance = distance;
        nearestCluster = cluster;
      }
    }

    if (nearestCluster) {
      // Add to existing cluster
      nearestCluster.eventCount++;
      nearestCluster.events.push(event);
      // Update cluster center to average position
      const totalEvents = nearestCluster.events.length;
      nearestCluster.lat = nearestCluster.events.reduce((sum, e) => sum + parseFloat(e.location_lat), 0) / totalEvents;
      nearestCluster.lng = nearestCluster.events.reduce((sum, e) => sum + parseFloat(e.location_lng), 0) / totalEvents;
    } else {
      // Create new cluster
      clusters.push({
        lat: eventLat,
        lng: eventLng,
        eventCount: 1,
        events: [event],
      });
    }
  });

  return clusters;
}

export function groupEventsByLocation(events: any[]): LocationMarker[] {
  const locationMap = new Map<string, LocationMarker>();

  events.forEach((event) => {
    if (!event.location_lat || !event.location_lng) return;

    const key = `${event.location_lat.toFixed(4)},${event.location_lng.toFixed(4)}`;

    if (locationMap.has(key)) {
      const marker = locationMap.get(key)!;
      marker.eventCount++;
      marker.events.push(event);
    } else {
      locationMap.set(key, {
        lat: parseFloat(event.location_lat),
        lng: parseFloat(event.location_lng),
        eventCount: 1,
        events: [event],
      });
    }
  });

  return Array.from(locationMap.values());
}
