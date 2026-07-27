import L from "leaflet";

/**
 * Continuous wheel and trackpad zoom.
 *
 * Leaflet's built-in `scrollWheelZoom` accumulates wheel ticks and fires
 * one discrete zoom step, which on a trackpad reads as a slow, jerky
 * staircase. This handler drives a requestAnimationFrame loop that eases
 * the actual zoom toward a running goal on every wheel event, so a
 * two-finger swipe zooms continuously and the point under the cursor
 * stays put.
 *
 * Leaflet.SmoothWheelZoom by mutsuyuki, MIT licensed:
 * https://github.com/mutsuyuki/Leaflet.SmoothWheelZoom
 *
 * Ported from the same handler inlined in tripi's `public/map.html`, so
 * both products feel the same. Two changes from the original, both noted
 * at the point they occur.
 */

/**
 * Leaflet's zoom internals are not in its public types. Naming exactly
 * what is reached for keeps the cast to one place and makes it obvious
 * what breaks if Leaflet renames something.
 */
interface MapInternal extends L.Map {
  _container: HTMLElement;
  _panAnim?: { stop(): void };
  _stop(): void;
  _limitZoom(zoom: number): number;
  _move(center: L.LatLng, zoom: number): void;
  _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
  _moveEnd(zoomChanged: boolean): void;
}

interface SmoothWheelOption {
  smoothWheelZoom?: boolean | "center";
  smoothSensitivity?: number;
}

/** How far the eased zoom travels toward the goal each frame. */
const EASING = 0.3;

/** Wheel delta to zoom levels. */
const DELTA_SCALE = 0.003;

/** Idle time after the last wheel event before the gesture is finished. */
const GESTURE_END_MS = 200;

export function installSmoothWheelZoom(): void {
  // Idempotent: the module may be imported by more than one component,
  // and adding the init hook twice would run two rAF loops per gesture.
  if ((L.Map as unknown as { SmoothWheelZoom?: unknown }).SmoothWheelZoom) return;

  L.Map.mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });

  const SmoothWheelZoom = L.Handler.extend({
    addHooks(this: SmoothZoomHandler) {
      // Leaflet types the DOM handler as taking a generic Event; the
      // listener genuinely receives a WheelEvent for the "wheel" name.
      L.DomEvent.on(this._map._container, "wheel", this._onWheelScroll as L.DomEvent.EventHandlerFn, this);
    },

    removeHooks(this: SmoothZoomHandler) {
      L.DomEvent.off(this._map._container, "wheel", this._onWheelScroll as L.DomEvent.EventHandlerFn, this);
    },

    _onWheelScroll(this: SmoothZoomHandler, event: WheelEvent) {
      if (!this._isWheeling) this._onWheelStart(event);
      this._onWheeling(event);
    },

    _onWheelStart(this: SmoothZoomHandler, event: WheelEvent) {
      const map = this._map;
      this._isWheeling = true;
      this._wheelMousePosition = map.mouseEventToContainerPoint(event);
      this._centerPoint = map.getSize().divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);
      this._moved = false;
      map._stop();
      map._panAnim?.stop();
      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      this._frameId = requestAnimationFrame(() => this._updateWheelZoom());
    },

    _onWheeling(this: SmoothZoomHandler, event: WheelEvent) {
      const map = this._map;
      const sensitivity = (map.options as SmoothWheelOption).smoothSensitivity ?? 1;

      this._goalZoom += L.DomEvent.getWheelDelta(event) * DELTA_SCALE * sensitivity;
      if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
        this._goalZoom = map._limitZoom(this._goalZoom);
      }
      this._wheelMousePosition = map.mouseEventToContainerPoint(event);
      this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);

      clearTimeout(this._timeoutId);
      this._timeoutId = setTimeout(() => this._onWheelEnd(), GESTURE_END_MS);

      L.DomEvent.preventDefault(event);
      L.DomEvent.stopPropagation(event);
    },

    _onWheelEnd(this: SmoothZoomHandler) {
      this._isWheeling = false;
      cancelAnimationFrame(this._frameId);
      this._map._moveEnd(true);
    },

    _updateWheelZoom(this: SmoothZoomHandler) {
      const map = this._map;

      // Something else moved the map mid-gesture; let it win.
      if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) return;

      const zoom = Math.floor((map.getZoom() + (this._goalZoom - map.getZoom()) * EASING) * 100) / 100;
      const delta = this._wheelMousePosition.subtract(this._centerPoint);

      // The original returned here without scheduling another frame, so a
      // cursor exactly at the centre stalled the loop and the gesture
      // froze. Zooming about the centre is the right behaviour for that
      // case, and the loop continues.
      const isAtCenter = delta.x === 0 && delta.y === 0;

      const center = isAtCenter || (map.options as SmoothWheelOption).smoothWheelZoom === "center"
        ? this._startLatLng
        : map.unproject(map.project(this._wheelMouseLatLng, zoom).subtract(delta), zoom);

      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }

      map._move(center, zoom);
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      this._frameId = requestAnimationFrame(() => this._updateWheelZoom());
    },
  });

  (L.Map as unknown as { SmoothWheelZoom: unknown }).SmoothWheelZoom = SmoothWheelZoom;
  L.Map.addInitHook("addHandler", "smoothWheelZoom", SmoothWheelZoom);
}

interface SmoothZoomHandler {
  _map: MapInternal;
  _isWheeling: boolean;
  _moved: boolean;
  _goalZoom: number;
  _prevZoom: number;
  _prevCenter: L.LatLng;
  _startLatLng: L.LatLng;
  _centerPoint: L.Point;
  _wheelMousePosition: L.Point;
  _wheelMouseLatLng: L.LatLng;
  _frameId: number;
  _timeoutId: ReturnType<typeof setTimeout>;
  _onWheelScroll(event: WheelEvent): void;
  _onWheelStart(event: WheelEvent): void;
  _onWheeling(event: WheelEvent): void;
  _onWheelEnd(): void;
  _updateWheelZoom(): void;
}
