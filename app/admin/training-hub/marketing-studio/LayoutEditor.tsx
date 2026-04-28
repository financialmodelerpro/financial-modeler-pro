'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { TemplateLayout } from '@/src/features/marketing-studio/layout';
import { mergeLayout, clampRect } from '@/src/features/marketing-studio/layout';
import type { LayoutOverrides } from '@/src/features/marketing-studio/types';

interface Props {
  /** Template's canvas + zone defaults + descriptors. */
  templateLayout: TemplateLayout;
  /** Current admin overrides (subset of zones). */
  overrides: LayoutOverrides;
  /** Zone keys the admin has hidden via the visibility panel. Drag boxes still
   *  render for these (faded) so the admin can find them again to un-hide. */
  hiddenZones?: string[];
  /** Server-rendered preview blob URL (the actual PNG output). */
  previewBlobUrl: string | null;
  /** State during preview regenerate. */
  generating: boolean;
  /** Called when admin commits a drag/resize (mouseup). */
  onLayoutChange: (next: LayoutOverrides) => void;
  /** Called to reset all overrides for this template. */
  onReset: () => void;
}

interface DragState {
  zoneKey: string;
  mode: 'move' | 'resize-e' | 'resize-s' | 'resize-se';
  /** Mouse position at drag start, in screen pixels (e.clientX/Y). */
  startScreenX: number;
  startScreenY: number;
  startRect: { x: number; y: number; w: number; h: number };
}

/**
 * Drag/resize layout editor. Renders the server PNG as a base layer and
 * overlays interactive boxes for each named zone the template declares.
 *
 *  - Click + drag a zone box to move it
 *  - Drag the right edge / bottom edge / SE corner to resize (zones with
 *    `resizable: true` only)
 *  - Coords work in canvas pixel space; the editor converts mouse delta
 *    (screen px) to canvas px via the displayed scale.
 *  - On mouseup the new rect is committed via onLayoutChange and the parent
 *    triggers a server re-render (which replaces the base PNG).
 */
export function LayoutEditor({
  templateLayout, overrides, hiddenZones, previewBlobUrl, generating, onLayoutChange, onReset,
}: Props) {
  const hiddenSet = React.useMemo(() => new Set(hiddenZones ?? []), [hiddenZones]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(800);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Optimistic rects shown while dragging (before server re-render commits). */
  const [optimistic, setOptimistic] = useState<LayoutOverrides>({});

  // Track container width for responsive scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { canvas, descriptors } = templateLayout;
  const scale = containerW / canvas.w;
  const displayH = canvas.h * scale;

  // Merge defaults + admin overrides + optimistic drag state
  const merged = mergeLayout(templateLayout.zones, { ...overrides, ...optimistic });

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const dxScreen = e.clientX - drag.startScreenX;
    const dyScreen = e.clientY - drag.startScreenY;
    const dxCanvas = dxScreen / scale;
    const dyCanvas = dyScreen / scale;
    let next = { ...drag.startRect };
    if (drag.mode === 'move') {
      next.x = drag.startRect.x + dxCanvas;
      next.y = drag.startRect.y + dyCanvas;
    } else if (drag.mode === 'resize-e') {
      next.w = drag.startRect.w + dxCanvas;
    } else if (drag.mode === 'resize-s') {
      next.h = drag.startRect.h + dyCanvas;
    } else if (drag.mode === 'resize-se') {
      next.w = drag.startRect.w + dxCanvas;
      next.h = drag.startRect.h + dyCanvas;
    }
    next = clampRect(next, canvas);
    setOptimistic(prev => ({ ...prev, [drag.zoneKey]: next }));
  };

  const onMouseUp = () => {
    if (!drag) return;
    const committed = optimistic[drag.zoneKey];
    if (committed) {
      // Merge committed rect into overrides; only store fields that differ from defaults
      const def = templateLayout.zones[drag.zoneKey];
      const next = { ...overrides };
      const diff: { x?: number; y?: number; w?: number; h?: number } = {};
      if (committed.x !== def.x) diff.x = committed.x;
      if (committed.y !== def.y) diff.y = committed.y;
      if (committed.w !== def.w) diff.w = committed.w;
      if (committed.h !== def.h) diff.h = committed.h;
      if (Object.keys(diff).length === 0) delete next[drag.zoneKey];
      else next[drag.zoneKey] = { x: committed.x, y: committed.y, w: committed.w, h: committed.h };
      onLayoutChange(next);
    }
    setDrag(null);
    // Clear optimistic AFTER a tick so the new server render has a chance to load
    setTimeout(() => setOptimistic({}), 50);
  };

  function startMove(zoneKey: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setActiveZone(zoneKey);
    const rect = merged[zoneKey];
    setDrag({ zoneKey, mode: 'move', startScreenX: e.clientX, startScreenY: e.clientY, startRect: rect });
  }

  function startResize(zoneKey: string, mode: 'resize-e' | 'resize-s' | 'resize-se', e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setActiveZone(zoneKey);
    const rect = merged[zoneKey];
    setDrag({ zoneKey, mode, startScreenX: e.clientX, startScreenY: e.clientY, startRect: rect });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6B7280' }}>
          Drag a box to move · drag the right/bottom edge to resize · {Math.round(containerW)} × {Math.round(displayH)}px preview ({(scale * 100).toFixed(0)}% of {canvas.w} × {canvas.h})
        </div>
        {Object.keys(overrides).length > 0 && (
          <button onClick={onReset}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}>
            ↺ Reset layout
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          position: 'relative',
          width: '100%',
          height: displayH,
          background: '#1a1a1a',
          border: '1px solid #E5E7EB',
          borderRadius: 10,
          overflow: 'hidden',
          userSelect: drag ? 'none' : 'auto',
          cursor: drag ? (drag.mode === 'move' ? 'grabbing' : drag.mode === 'resize-e' ? 'ew-resize' : drag.mode === 'resize-s' ? 'ns-resize' : 'nwse-resize') : 'default',
        }}
      >
        {/* Base PNG preview (re-rendered server-side after each commit) */}
        {previewBlobUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={previewBlobUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none', opacity: drag ? 0.7 : 1 }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontSize: 13 }}>
            {generating ? 'Generating…' : 'Loading preview…'}
          </div>
        )}

        {/* Zone overlays - one per descriptor */}
        {descriptors.map(desc => {
          const r = merged[desc.key];
          if (!r) return null;
          const isActive = activeZone === desc.key;
          const isHidden = hiddenSet.has(desc.key);
          const left = r.x * scale;
          const top = r.y * scale;
          const width = r.w * scale;
          const height = r.h * scale;
          const isDragging = drag?.zoneKey === desc.key;
          // Hidden zones get muted gray styling so they read as "not on the
          // PNG but still positionable" - admin can drag them around then
          // un-hide via the sidebar checklist when ready.
          const borderColor = isActive ? (isHidden ? '#9CA3AF' : '#3B82F6')
            : isHidden ? 'rgba(156,163,175,0.6)' : 'rgba(59,130,246,0.55)';
          const borderStyle = isHidden ? 'dotted' : (isActive ? 'solid' : 'dashed');
          const fillColor = isActive
            ? (isHidden ? 'rgba(156,163,175,0.18)' : 'rgba(59,130,246,0.15)')
            : (isHidden ? 'rgba(156,163,175,0.06)' : 'rgba(59,130,246,0.05)');
          const chipColor = isHidden ? (isActive ? '#6B7280' : 'rgba(107,114,128,0.85)')
            : (isActive ? '#3B82F6' : 'rgba(59,130,246,0.85)');
          return (
            <div
              key={desc.key}
              onMouseDown={e => startMove(desc.key, e)}
              onClick={e => { e.stopPropagation(); setActiveZone(desc.key); }}
              style={{
                position: 'absolute',
                left, top, width, height,
                border: `2px ${borderStyle} ${borderColor}`,
                background: fillColor,
                cursor: isDragging ? 'grabbing' : 'grab',
                boxSizing: 'border-box',
                transition: isDragging ? 'none' : 'background 0.12s ease',
              }}
              title={`${desc.label}${isHidden ? ' (hidden)' : ''} (${Math.round(r.x)}, ${Math.round(r.y)}) · ${Math.round(r.w)} × ${Math.round(r.h)}`}
            >
              {/* Label chip */}
              <div style={{
                position: 'absolute', top: -22, left: 0,
                fontSize: 10, fontWeight: 800,
                background: chipColor,
                color: '#fff', padding: '2px 6px', borderRadius: 3,
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>
                {isHidden && <span style={{ marginRight: 4, opacity: 0.85 }}>HIDDEN</span>}
                {desc.label}
                {isActive && <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{Math.round(r.x)}, {Math.round(r.y)} · {Math.round(r.w)} × {Math.round(r.h)}</span>}
              </div>

              {/* Resize handles (resizable zones only) */}
              {desc.resizable && (
                <>
                  {/* Right edge */}
                  <div onMouseDown={e => startResize(desc.key, 'resize-e', e)}
                    style={{ position: 'absolute', top: 0, right: -4, bottom: 0, width: 8, cursor: 'ew-resize', background: isActive ? 'rgba(59,130,246,0.4)' : 'transparent' }} />
                  {/* Bottom edge */}
                  <div onMouseDown={e => startResize(desc.key, 'resize-s', e)}
                    style={{ position: 'absolute', left: 0, right: 0, bottom: -4, height: 8, cursor: 'ns-resize', background: isActive ? 'rgba(59,130,246,0.4)' : 'transparent' }} />
                  {/* SE corner */}
                  <div onMouseDown={e => startResize(desc.key, 'resize-se', e)}
                    style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, cursor: 'nwse-resize', background: isActive ? '#3B82F6' : 'rgba(59,130,246,0.7)', borderRadius: 2 }} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
