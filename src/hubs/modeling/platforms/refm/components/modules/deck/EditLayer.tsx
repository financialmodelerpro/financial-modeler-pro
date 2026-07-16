/**
 * EditLayer.tsx (REFM Module 7, IC Presentation Builder: direct manipulation)
 *
 * The interaction surface that sits ON TOP of the visual slide. The visual layer
 * (SlideCanvas / SlideObjectView) stays a pure, read-only renderer; all
 * selecting, dragging, resizing and inline text editing happens here, so the two
 * concerns never entangle.
 *
 * Coordinates: this overlay works in DEVICE pixels (the on-screen slide size),
 * but the deck stores LOGICAL pixels (1280 x 720). The single conversion is the
 * scale factor: a pointer delta in device px becomes a logical delta by dividing
 * by `scale`, and a logical box becomes a device box by multiplying. Snapping and
 * mutations happen in logical space (via snapping.ts), so what the user drags is
 * exactly what the model, and later PowerPoint, receives.
 *
 * The gesture lifecycle drives undo history cleanly: onGestureStart fires once at
 * pointer-down (the parent snapshots the pre-drag deck), every move calls
 * onTransform with fresh patches derived from the gesture's captured base (so
 * moves never compound), and the parent commits that one snapshot on
 * pointer-up. A drag is therefore one undo step, not one per pixel.
 *
 * No em dashes in this file.
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckObject, Slide } from '../../../lib/reports/deck/types';
import type { ObjectPatch } from '../../../lib/reports/deck/mutations';
import { boundingBox, snapMove, snapResize, type Box, type Guide, type Handle } from '../../../lib/reports/deck/snapping';
import { DECK_THEME, fontFor, fontStack } from '../../../lib/reports/deck/theme';
import { styleToCss } from './SlideObjectView';
import type { DeckBranding } from '../../../lib/reports/deck/types';

export interface EditLayerProps {
  slide: Slide;
  branding: DeckBranding;
  scale: number;
  width: number;   // device px
  height: number;  // device px
  selectedIds: string[];
  editingId: string | null;
  onSelect: (ids: string[]) => void;
  onBeginEdit: (id: string | null) => void;
  /** One-time snapshot point so the parent can push undo history. */
  onGestureStart: () => void;
  /** Live geometry update during a gesture (no history push). */
  onTransform: (patches: Record<string, ObjectPatch>) => void;
  /** Commit an inline text edit. `value` is a string for text, string[] for bullets. */
  onTextCommit: (id: string, value: string | string[]) => void;
}

type Gesture =
  | { kind: 'move'; startX: number; startY: number; base: Record<string, Box> }
  | { kind: 'resize'; startX: number; startY: number; handle: Handle; id: string; base: Box }
  | null;

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_PX = 9;
const cursorFor: Record<Handle, string> = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };

export default function EditLayer(props: EditLayerProps): React.JSX.Element {
  const { slide, branding, scale, width, height, selectedIds, editingId, onSelect, onBeginEdit, onGestureStart, onTransform, onTextCommit } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  const selectable = slide.objects.filter((o) => !o.hidden);
  const selected = selectable.filter((o) => selectedIds.includes(o.id));
  const othersOf = (ids: string[]): Box[] => selectable.filter((o) => !ids.includes(o.id)).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));

  const toDevice = (v: number): number => v * scale;

  // ── Pointer gesture handling (window-level while active) ──────────────────
  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const dxL = (e.clientX - g.startX) / scale;
    const dyL = (e.clientY - g.startY) / scale;

    if (g.kind === 'move') {
      const ids = Object.keys(g.base);
      const bb = boundingBox(ids.map((id) => g.base[id]));
      const moved: Box = { x: bb.x + dxL, y: bb.y + dyL, w: bb.w, h: bb.h };
      const snapped = snapMove(moved, othersOf(ids));
      const appliedDx = snapped.box.x - bb.x;
      const appliedDy = snapped.box.y - bb.y;
      const patches: Record<string, ObjectPatch> = {};
      ids.forEach((id) => { patches[id] = { x: g.base[id].x + appliedDx, y: g.base[id].y + appliedDy }; });
      onTransform(patches);
      setGuides(snapped.guides);
    } else if (g.kind === 'resize') {
      const snapped = snapResize(g.base, g.handle, dxL, dyL, othersOf([g.id]));
      onTransform({ [g.id]: { x: snapped.box.x, y: snapped.box.y, w: snapped.box.w, h: snapped.box.h } });
      setGuides(snapped.guides);
    }
  }, [scale, onTransform, selectable]);

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    setGuides([]);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endGesture);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endGesture);
  }, [onPointerMove, endGesture]);

  const beginMove = (e: React.PointerEvent, obj: DeckObject) => {
    e.stopPropagation();
    if (obj.locked || editingId) return;
    // Selection: shift toggles into the set, otherwise select just this one
    // (unless it is already part of a multi-selection being dragged).
    let ids = selectedIds;
    if (e.shiftKey) {
      ids = selectedIds.includes(obj.id) ? selectedIds.filter((i) => i !== obj.id) : [...selectedIds, obj.id];
      onSelect(ids);
      return; // shift-click toggles selection, does not start a drag
    }
    if (!selectedIds.includes(obj.id)) { ids = [obj.id]; onSelect(ids); }
    const base: Record<string, Box> = {};
    selectable.filter((o) => ids.includes(o.id) && !o.locked).forEach((o) => { base[o.id] = { x: o.x, y: o.y, w: o.w, h: o.h }; });
    if (!Object.keys(base).length) return;
    onGestureStart();
    gestureRef.current = { kind: 'move', startX: e.clientX, startY: e.clientY, base };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endGesture);
  };

  const beginResize = (e: React.PointerEvent, obj: DeckObject, handle: Handle) => {
    e.stopPropagation();
    if (obj.locked || editingId) return;
    onGestureStart();
    gestureRef.current = { kind: 'resize', startX: e.clientX, startY: e.clientY, handle, id: obj.id, base: { x: obj.x, y: obj.y, w: obj.w, h: obj.h } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endGesture);
  };

  // Single selection drives the resize handles; multi-selection shows outlines only.
  const single = selected.length === 1 && !selected[0].locked ? selected[0] : null;

  return (
    <div
      ref={rootRef}
      data-testid="deck-edit-layer"
      onPointerDown={(e) => { if (e.target === rootRef.current) { onSelect([]); onBeginEdit(null); } }}
      style={{ position: 'absolute', inset: 0, width, height }}
    >
      {/* Hit areas + per-object selection outline */}
      {selectable.map((o) => {
        const isSel = selectedIds.includes(o.id);
        const isEditing = editingId === o.id;
        return (
          <div
            key={o.id}
            data-object-hit={o.id}
            onPointerDown={(e) => beginMove(e, o)}
            onDoubleClick={(e) => { e.stopPropagation(); if ((o.type === 'text' || o.type === 'bullets') && !o.locked) onBeginEdit(o.id); }}
            style={{
              position: 'absolute',
              left: toDevice(o.x), top: toDevice(o.y), width: toDevice(o.w), height: toDevice(o.h),
              cursor: o.locked ? 'default' : isEditing ? 'text' : 'move',
              outline: isSel ? `1.5px solid ${DECK_THEME.navy}` : o.locked ? 'none' : '1px solid transparent',
              outlineOffset: 1,
              background: 'transparent',
              pointerEvents: isEditing ? 'none' : 'auto',
            }}
          />
        );
      })}

      {/* Resize handles for a single selection */}
      {single && !editingId ? HANDLES.map((h) => {
        const hx = single.x + (h.includes('w') ? 0 : h.includes('e') ? single.w : single.w / 2);
        const hy = single.y + (h.includes('n') ? 0 : h.includes('s') ? single.h : single.h / 2);
        return (
          <div
            key={h}
            data-handle={h}
            onPointerDown={(e) => beginResize(e, single, h)}
            style={{
              position: 'absolute',
              left: toDevice(hx) - HANDLE_PX / 2, top: toDevice(hy) - HANDLE_PX / 2,
              width: HANDLE_PX, height: HANDLE_PX, background: '#FFFFFF',
              border: `1.5px solid ${DECK_THEME.navy}`, borderRadius: 2, cursor: cursorFor[h], zIndex: 3,
            }}
          />
        );
      }) : null}

      {/* Alignment guides */}
      {guides.map((g, i) => (
        <div
          key={i}
          style={g.axis === 'x'
            ? { position: 'absolute', left: toDevice(g.pos), top: 0, width: 1, height, background: DECK_THEME.red, zIndex: 4, pointerEvents: 'none' }
            : { position: 'absolute', top: toDevice(g.pos), left: 0, height: 1, width, background: DECK_THEME.red, zIndex: 4, pointerEvents: 'none' }}
        />
      ))}

      {/* Inline text editor */}
      {editingId ? (() => {
        const o = selectable.find((x) => x.id === editingId);
        if (!o || (o.type !== 'text' && o.type !== 'bullets')) return null;
        return <InlineEditor key={o.id} obj={o} branding={branding} scale={scale} onCommit={onTextCommit} onDone={() => onBeginEdit(null)} />;
      })() : null}
    </div>
  );
}

// ── Inline text editor ──────────────────────────────────────────────────────
// A contentEditable overlaid exactly on the object, styled to match, so editing
// looks in-place. Text objects edit a single string; bullets edit one item per
// line. Commit on blur or Ctrl+Enter; cancel on Escape.

function InlineEditor({
  obj, branding, scale, onCommit, onDone,
}: {
  obj: DeckObject; branding: DeckBranding; scale: number; onCommit: (id: string, v: string | string[]) => void; onDone: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const isBullets = obj.type === 'bullets';
  const initial = isBullets ? (obj as { items: string[] }).items.join('\n') : (obj as { text: string }).text;
  const style = (obj as { style?: import('../../../lib/reports/deck/types').TextStyle }).style;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [initial]);

  const commit = () => {
    const raw = ref.current?.innerText ?? '';
    if (isBullets) onCommit(obj.id, raw.split('\n').map((l) => l.trim()).filter(Boolean));
    else onCommit(obj.id, raw);
    onDone();
  };

  const css: React.CSSProperties = style
    ? { ...styleToCss(style, branding), fontSize: (style.size) * scale, lineHeight: style.lineHeight ?? 1.35 }
    : { fontFamily: fontStack(fontFor(branding, 'body')), fontSize: 13 * scale };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid="deck-inline-editor"
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onDone(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      }}
      style={{
        position: 'absolute',
        left: obj.x * scale, top: obj.y * scale, width: obj.w * scale, height: obj.h * scale,
        ...css,
        background: 'rgba(255,255,255,0.96)', outline: `2px solid ${DECK_THEME.navy}`,
        padding: 2, zIndex: 5, overflow: 'hidden', whiteSpace: 'pre-wrap', cursor: 'text',
      }}
    />
  );
}
