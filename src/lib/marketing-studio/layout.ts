import type { ZoneRect, LayoutOverrides } from './types';

/**
 * Default rect schema per template. Each template defines its zones with
 * default {x, y, w, h} in canvas pixel space.
 */
export type ZoneDefaults = Record<string, Required<ZoneRect>>;

/**
 * A typed zone descriptor used by the layout editor UI. Each zone declares
 * whether resize is allowed (text blocks yes; trainer cards usually no).
 */
export interface ZoneDescriptor {
  key: string;
  label: string;
  /** Allow drag (move). Default true. */
  draggable?: boolean;
  /** Allow resize via right-edge / bottom-edge handles. */
  resizable?: boolean;
}

/**
 * Per-template registry. Studio editors look this up to know which zones to
 * expose draggable handles for.
 */
export interface TemplateLayout {
  canvas: { w: number; h: number };
  zones: ZoneDefaults;
  descriptors: ZoneDescriptor[];
}

/**
 * Merge defaults with admin overrides. Missing fields fall back to defaults.
 * Returns a fully-populated rect for every zone the template defines.
 */
export function mergeLayout(defaults: ZoneDefaults, overrides?: LayoutOverrides): ZoneDefaults {
  if (!overrides) return defaults;
  const out: ZoneDefaults = {};
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    const o = overrides[k];
    out[k] = {
      x: o?.x ?? d.x,
      y: o?.y ?? d.y,
      w: o?.w ?? d.w,
      h: o?.h ?? d.h,
    };
  }
  return out;
}

/**
 * Convert a rect to absolute-positioning style. Used by both server (satori)
 * and client (mirror preview) so the same coords produce the same output.
 */
export function rectToStyle(r: { x: number; y: number; w: number; h: number }): React.CSSProperties {
  return {
    position: 'absolute',
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
    display: 'flex',
  };
}

/**
 * Clamp a rect inside the canvas. Used by the drag handler to prevent
 * dragging zones off the visible area.
 */
export function clampRect(
  r: { x: number; y: number; w: number; h: number },
  canvas: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(40, Math.min(canvas.w, r.w));
  const h = Math.max(20, Math.min(canvas.h, r.h));
  const x = Math.max(0, Math.min(canvas.w - w, r.x));
  const y = Math.max(0, Math.min(canvas.h - h, r.y));
  return { x, y, w, h };
}
