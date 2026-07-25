import L from "leaflet";
import markerIcon from "@/assets/middle-finger-marker.png";
import { getCategoryFilter } from "@/constant/categoryColors";

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
        class="absolute inset-0 w-full h-full block pointer-event-none"
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
            pointer-event:none;
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
