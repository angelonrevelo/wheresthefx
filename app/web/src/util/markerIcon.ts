import L from "leaflet";
import { CATEGORY_COLORS } from "@/constant/categoryColors";

/**
 * Map markers.
 *
 * These were a middle-finger PNG rotated 180 degrees and recoloured with a
 * hand-tuned CSS `filter` chain per category — thirteen strings of
 * `invert/sepia/saturate/hue-rotate` approximating hex values declared
 * immediately above them in the same file. At 32x40 the rotated hand read
 * as a smear rather than a pin, and a filter chain only ever gets close to
 * the colour it is imitating.
 *
 * Drawn as SVG instead: the category colour is applied directly, the shape
 * points at the thing it marks, and a dark outline keeps it legible
 * against the dark basemap.
 */

const ICON_W = 30;
const ICON_H = 40;

/** Multi-event pins grow a little so the count stays readable. */
const CLUSTER_W = 38;
const CLUSTER_H = 48;

function colorFor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

export function createEventMarkerIcon(count: number, category: string = "other"): L.DivIcon {
  const isCluster = count > 1;
  const width = isCluster ? CLUSTER_W : ICON_W;
  const height = isCluster ? CLUSTER_H : ICON_H;
  const fill = colorFor(category);
  const label = count > 99 ? "99+" : String(count);

  // The viewBox is fixed, so the geometry scales with the rendered size.
  const html = `
    <div style="width:${width}px;height:${height}px;position:relative;">
      <svg viewBox="0 0 30 40" width="${width}" height="${height}"
           xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
           style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));">
        <path d="M15 39C15 39 28 24.4 28 14.5 28 6.5 22.2 1 15 1S2 6.5 2 14.5C2 24.4 15 39 15 39Z"
              fill="${fill}" stroke="rgba(10,10,14,.85)" stroke-width="1.75"/>
        <circle cx="15" cy="14.5" r="${isCluster ? 8.5 : 4.6}" fill="rgba(10,10,14,.9)"/>
      </svg>
      ${isCluster ? `
        <span style="position:absolute;left:50%;top:36.25%;transform:translate(-50%,-50%);
                     color:#fff;font-weight:600;font-size:${count > 99 ? 10 : 12}px;line-height:1;
                     font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                     pointer-events:none;">${label}</span>
      ` : ""}
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [width, height],
    // The tip is the location, so the anchor sits at the bottom centre.
    // The old icon anchored 2px short of it, which offset every pin.
    iconAnchor: [width / 2, height],
    popupAnchor: [0, -height + 6],
  });
}

/** Former name, kept so existing call sites keep working. */
export const createMiddleFingerIcon = createEventMarkerIcon;
