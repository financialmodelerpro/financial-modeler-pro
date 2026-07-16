/**
 * snapping.ts (REFM Module 7, IC Presentation Builder: snap + alignment guides)
 *
 * The guardrail that keeps a freely dragged deck looking institutional. When an
 * object moves or resizes, this decides where it actually lands: it prefers to
 * align an edge or centre to a nearby object, the content margins, or the slide
 * centre lines, and falls back to the 8px grid otherwise. The alignment lines it
 * returns are drawn live so the user sees WHY it snapped.
 *
 * Everything here is pure and in LOGICAL slide coordinates (1280 x 720). The
 * overlay converts to device pixels once, at the edge, so this file never has to
 * know the zoom.
 *
 * No em dashes in this file.
 */

import { GRID, MARGIN, SLIDE_W, SLIDE_H, CONTENT_W, snap } from './types';

export interface Box { x: number; y: number; w: number; h: number }
/** A single alignment line the overlay draws while a gesture is active. */
export interface Guide { axis: 'x' | 'y'; pos: number }
export interface SnapResult { box: Box; guides: Guide[] }

/** Snap distance in logical px. Within this, alignment wins over the grid. */
export const SNAP_THRESHOLD = 6;

/** Candidate target lines on an axis: every other object's near / centre / far
 *  edge, plus the content margins and the slide centre. */
function targetsX(others: Box[]): number[] {
  const t = [MARGIN, MARGIN + CONTENT_W, SLIDE_W / 2];
  for (const o of others) t.push(o.x, o.x + o.w / 2, o.x + o.w);
  return t;
}
function targetsY(others: Box[]): number[] {
  const t = [MARGIN, SLIDE_H - MARGIN, SLIDE_H / 2];
  for (const o of others) t.push(o.y, o.y + o.h / 2, o.y + o.h);
  return t;
}

/** Nearest target to any of the box's anchors on one axis. Returns the offset to
 *  apply and the guide line, or null when nothing is within threshold. */
function bestSnap(anchors: number[], targets: number[], threshold: number): { delta: number; pos: number } | null {
  let best: { delta: number; pos: number } | null = null;
  for (const a of anchors) {
    for (const t of targets) {
      const d = t - a;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, pos: t };
      }
    }
  }
  return best;
}

/**
 * Snap a moving box. Tries edge / centre alignment first (emitting a guide),
 * then grid-snaps whatever axis did not align. The box keeps its size.
 */
export function snapMove(box: Box, others: Box[], threshold = SNAP_THRESHOLD): SnapResult {
  const guides: Guide[] = [];
  let { x, y } = box;

  const sx = bestSnap([box.x, box.x + box.w / 2, box.x + box.w], targetsX(others), threshold);
  if (sx) { x = box.x + sx.delta; guides.push({ axis: 'x', pos: sx.pos }); }
  else { x = snap(box.x); }

  const sy = bestSnap([box.y, box.y + box.h / 2, box.y + box.h], targetsY(others), threshold);
  if (sy) { y = box.y + sy.delta; guides.push({ axis: 'y', pos: sy.pos }); }
  else { y = snap(box.y); }

  return { box: { x, y, w: box.w, h: box.h }, guides };
}

/** The eight resize handles. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN = GRID * 2;

/**
 * Resize a box by dragging one handle. The moving edge(s) snap to nearby target
 * lines or the grid; the anchored edge(s) stay put. Enforces a minimum size so
 * an object can never be dragged to nothing.
 */
export function snapResize(start: Box, handle: Handle, dx: number, dy: number, others: Box[], threshold = SNAP_THRESHOLD): SnapResult {
  const guides: Guide[] = [];
  let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  const tx = targetsX(others), ty = targetsY(others);

  if (movesLeft) {
    left += dx;
    const s = bestSnap([left], tx, threshold);
    if (s) { left = s.pos; guides.push({ axis: 'x', pos: s.pos }); } else left = snap(left);
    left = Math.min(left, right - MIN);
  }
  if (movesRight) {
    right += dx;
    const s = bestSnap([right], tx, threshold);
    if (s) { right = s.pos; guides.push({ axis: 'x', pos: s.pos }); } else right = snap(right);
    right = Math.max(right, left + MIN);
  }
  if (movesTop) {
    top += dy;
    const s = bestSnap([top], ty, threshold);
    if (s) { top = s.pos; guides.push({ axis: 'y', pos: s.pos }); } else top = snap(top);
    top = Math.min(top, bottom - MIN);
  }
  if (movesBottom) {
    bottom += dy;
    const s = bestSnap([bottom], ty, threshold);
    if (s) { bottom = s.pos; guides.push({ axis: 'y', pos: s.pos }); } else bottom = snap(bottom);
    bottom = Math.max(bottom, top + MIN);
  }

  return { box: { x: left, y: top, w: right - left, h: bottom - top }, guides };
}

/** The bounding box of several boxes, for group drag + group selection outline. */
export function boundingBox(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bt - y };
}
