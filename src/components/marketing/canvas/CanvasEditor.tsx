'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import type { CanvasElement, Design, CanvasBackground, BrandKit } from '@/src/lib/marketing/types';
import { ElementRenderer } from './ElementRenderer';
import { PropertiesPanel } from './PropertiesPanel';
import { makeTextElement, makeImageElement, makeShapeElement, backgroundToCss, uid } from '@/src/lib/marketing/canvasDefaults';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

interface Props {
  design: Design;
  brandKit: BrandKit;
  onDesignChange: (design: Design) => void;
  onBrandKitChange?: (patch: Partial<BrandKit>) => void;
}

/** The full canvas editor surface — left panel, canvas, right panel. */
export function CanvasEditor({ design, brandKit, onDesignChange, onBrandKitChange }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // History stack for undo/redo (simple snapshot of design)
  const historyRef = useRef<Design[]>([design]);
  const historyIndexRef = useRef(0);
  const [, forceRender] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<CanvasElement | null>(null);

  const selected = useMemo(() => design.elements.find(e => e.id === selectedId) ?? null, [design.elements, selectedId]);

  // ── History helpers ──────────────────────────────────────────────────────
  const pushHistory = useCallback((next: Design) => {
    const cut = historyRef.current.slice(0, historyIndexRef.current + 1);
    cut.push(next);
    // Cap history at 50 entries
    if (cut.length > 50) cut.shift();
    historyRef.current = cut;
    historyIndexRef.current = cut.length - 1;
    forceRender(n => n + 1);
  }, []);

  const commitDesign = useCallback((next: Design) => {
    onDesignChange(next);
    pushHistory(next);
  }, [onDesignChange, pushHistory]);

  // Replace the editor's latest-snapshot when parent rehydrates a different design
  // (e.g. user loads a saved design from the list). This prevents undo jumping
  // between unrelated designs.
  useEffect(() => {
    if (design.id !== historyRef.current[historyIndexRef.current]?.id) {
      historyRef.current = [design];
      historyIndexRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.id]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    onDesignChange(historyRef.current[historyIndexRef.current]);
    forceRender(n => n + 1);
  }, [onDesignChange]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    onDesignChange(historyRef.current[historyIndexRef.current]);
    forceRender(n => n + 1);
  }, [onDesignChange]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  // ── Element mutations ────────────────────────────────────────────────────
  const addElement = useCallback((el: CanvasElement) => {
    const maxZ = design.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const next: Design = { ...design, elements: [...design.elements, { ...el, zIndex: maxZ + 1 }] };
    commitDesign(next);
    setSelectedId(el.id);
  }, [design, commitDesign]);

  const updateElement = useCallback((id: string, patch: Partial<CanvasElement>) => {
    const next: Design = {
      ...design,
      elements: design.elements.map(e => e.id === id ? { ...e, ...patch, text: patch.text ?? e.text, image: patch.image ?? e.image, shape: patch.shape ?? e.shape } : e),
    };
    commitDesign(next);
  }, [design, commitDesign]);

  // Drag-end / resize-end both use this: coalesce into history only on release.
  const updateElementPosition = useCallback((id: string, patch: Partial<CanvasElement>) => {
    updateElement(id, patch);
  }, [updateElement]);

  const deleteElement = useCallback((id: string) => {
    const next: Design = { ...design, elements: design.elements.filter(e => e.id !== id) };
    commitDesign(next);
    if (selectedId === id) setSelectedId(null);
  }, [design, commitDesign, selectedId]);

  const duplicateElement = useCallback((id: string) => {
    const src = design.elements.find(e => e.id === id);
    if (!src) return;
    const maxZ = design.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const copy: CanvasElement = { ...src, id: uid(), x: src.x + 20, y: src.y + 20, zIndex: maxZ + 1 };
    const next: Design = { ...design, elements: [...design.elements, copy] };
    commitDesign(next);
    setSelectedId(copy.id);
  }, [design, commitDesign]);

  const changeZ = useCallback((id: string, dir: 'forward' | 'backward') => {
    const el = design.elements.find(e => e.id === id);
    if (!el) return;
    updateElement(id, { zIndex: el.zIndex + (dir === 'forward' ? 1 : -1) });
  }, [design.elements, updateElement]);

  const updateBackground = useCallback((patch: Partial<CanvasBackground>) => {
    commitDesign({ ...design, background: { ...design.background, ...patch } });
  }, [design, commitDesign]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore shortcuts while typing in editable fields
      const tgt = e.target as HTMLElement;
      const editing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);

      const meta = e.ctrlKey || e.metaKey;

      if (meta && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) redo(); else undo();
        e.preventDefault(); return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) { redo(); e.preventDefault(); return; }

      if (editing) return;

      if (selectedId) {
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteElement(selectedId); e.preventDefault(); return; }
        if (meta && (e.key === 'd' || e.key === 'D')) { duplicateElement(selectedId); e.preventDefault(); return; }
        if (meta && (e.key === 'c' || e.key === 'C')) {
          const src = design.elements.find(el => el.id === selectedId);
          if (src) clipboardRef.current = src;
          return;
        }
        if (e.key === 'Escape') { setSelectedId(null); return; }
        if (e.key.startsWith('Arrow')) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
          const el = design.elements.find(x => x.id === selectedId);
          if (el && (dx || dy)) {
            updateElement(selectedId, { x: el.x + dx, y: el.y + dy });
            e.preventDefault();
          }
          return;
        }
      }

      if (meta && (e.key === 'v' || e.key === 'V')) {
        const src = clipboardRef.current;
        if (src) {
          const maxZ = design.elements.reduce((m, el) => Math.max(m, el.zIndex), 0);
          const copy: CanvasElement = { ...src, id: uid(), x: src.x + 20, y: src.y + 20, zIndex: maxZ + 1 };
          commitDesign({ ...design, elements: [...design.elements, copy] });
          setSelectedId(copy.id);
          e.preventDefault();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, design, undo, redo, deleteElement, duplicateElement, updateElement, commitDesign]);

  // ── Auto-fit zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    function recompute() {
      const el = containerRef.current;
      if (!el) return;
      const availW = el.clientWidth - 48;
      const availH = el.clientHeight - 48;
      const s = Math.min(availW / design.dimensions.width, availH / design.dimensions.height, 1);
      setZoom(Math.max(0.1, s));
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [design.dimensions.width, design.dimensions.height]);

  // ── Render ───────────────────────────────────────────────────────────────
  const bgCss = backgroundToCss(design.background);
  const sortedElements = useMemo(() => [...design.elements].sort((a, b) => a.zIndex - b.zIndex), [design.elements]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 300px', gap: 16, alignItems: 'stretch', minHeight: 600 }}>

      {/* ── LEFT: Elements + Layers ──────────────────────────────────────── */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={panel}>
          <div style={panelTitle}>Add Element</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button onClick={() => addElement(makeTextElement())}  style={elBtn}>＋  Text</button>
            <button onClick={() => addElement(makeImageElement(brandKit.logo_url || ''))} style={elBtn}>＋  Image</button>
            <button onClick={() => addElement(makeShapeElement())} style={elBtn}>＋  Shape</button>
          </div>
        </div>

        <div style={panel}>
          <div style={panelTitle}>Layers</div>
          {design.elements.length === 0 ? (
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>No elements yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
              {[...design.elements].sort((a, b) => b.zIndex - a.zIndex).map(el => (
                <button
                  key={el.id}
                  onClick={() => setSelectedId(el.id)}
                  style={{
                    textAlign: 'left', padding: '5px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    background: selectedId === el.id ? '#F0F5FA' : 'transparent',
                    border: selectedId === el.id ? `1px solid ${NAVY}` : '1px solid transparent',
                    color: NAVY, fontWeight: selectedId === el.id ? 700 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {iconFor(el.type)} {labelFor(el)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={panel}>
          <div style={panelTitle}>History</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={undo} disabled={!canUndo} style={{ ...elBtn, opacity: canUndo ? 1 : 0.4 }}>↶ Undo</button>
            <button onClick={redo} disabled={!canRedo} style={{ ...elBtn, opacity: canRedo ? 1 : 0.4 }}>↷ Redo</button>
          </div>
        </div>
      </aside>

      {/* ── MIDDLE: Canvas ───────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ background: '#111827', borderRadius: 10, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 600, overflow: 'auto' }}>
        <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 10, color: '#9CA3AF' }}>
          {design.dimensions.width} × {design.dimensions.height}px · {Math.round(zoom * 100)}% zoom
        </div>
        <div
          style={{
            width: design.dimensions.width,
            height: design.dimensions.height,
            transform: `scale(${zoom})`,
            transformOrigin: 'center',
            position: 'relative',
            flexShrink: 0,
            boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
            ...bgCss,
          }}
          onClick={(e) => {
            // Clicking empty canvas deselects
            if (e.currentTarget === e.target) setSelectedId(null);
          }}
        >
          {/* Image overlay (above background, below elements) */}
          {design.background.type === 'image' && design.background.overlay && (
            <div style={{
              position: 'absolute', inset: 0,
              background: design.background.overlay.color,
              opacity: design.background.overlay.opacity / 100,
              pointerEvents: 'none',
            }} />
          )}

          {sortedElements.map(el => {
            const lockAR =
              el.type === 'image' ? (el.image?.lockAspectRatio !== false)
            : el.type === 'shape' ? (el.shape?.lockAspectRatio === true)
            : false;
            return (
              <Rnd
                key={el.id}
                size={{ width: el.width, height: el.height }}
                position={{ x: el.x, y: el.y }}
                bounds="parent"
                scale={zoom}
                lockAspectRatio={lockAR}
                onDragStop={(_, d) => updateElementPosition(el.id, { x: d.x, y: d.y })}
                onResizeStop={(_e, _dir, ref, _delta, pos) => {
                  updateElementPosition(el.id, {
                    width:  parseInt(ref.style.width, 10),
                    height: parseInt(ref.style.height, 10),
                    x: pos.x, y: pos.y,
                  });
                }}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(el.id); }}
                style={{
                  zIndex: el.zIndex,
                  outline: selectedId === el.id ? `2px dashed ${NAVY}` : 'none',
                  outlineOffset: 2,
                  cursor: 'move',
                }}
                resizeHandleStyles={selectedId === el.id ? handleStyles : hiddenHandles}
              >
                <ElementRenderer element={el} />
              </Rnd>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: Properties ────────────────────────────────────────────── */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
        <PropertiesPanel
          selected={selected}
          background={design.background}
          brandKit={brandKit}
          onUpdateElement={(patch) => selectedId && updateElement(selectedId, patch)}
          onUpdateBackground={updateBackground}
          onDelete={() => selectedId && deleteElement(selectedId)}
          onDuplicate={() => selectedId && duplicateElement(selectedId)}
          onBringForward={() => selectedId && changeZ(selectedId, 'forward')}
          onSendBackward={() => selectedId && changeZ(selectedId, 'backward')}
          onAddBrandImage={(url) => addElement(makeImageElement(url))}
          onBrandKitChange={(patch) => onBrandKitChange?.(patch)}
        />
      </aside>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function iconFor(type: CanvasElement['type']) {
  return type === 'text' ? 'T' : type === 'image' ? '🖼' : '▭';
}
function labelFor(el: CanvasElement): string {
  if (el.type === 'text' && el.text) return el.text.content.slice(0, 24) || 'Text';
  if (el.type === 'image') return 'Image';
  return 'Shape';
}

const panel: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10 };
const panelTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 };
const elBtn: React.CSSProperties = { padding: '8px 10px', fontSize: 12, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: `1px solid ${BORDER}`, background: '#fff', color: NAVY, textAlign: 'left', flex: 1 };
const handleBase: React.CSSProperties = { width: 10, height: 10, background: NAVY, border: '2px solid #fff', borderRadius: 2, zIndex: 100 };
const handleStyles = {
  top: handleBase, bottom: handleBase, left: handleBase, right: handleBase,
  topLeft: handleBase, topRight: handleBase, bottomLeft: handleBase, bottomRight: handleBase,
};
const hiddenHandles = {
  top: { display: 'none' }, bottom: { display: 'none' }, left: { display: 'none' }, right: { display: 'none' },
  topLeft: { display: 'none' }, topRight: { display: 'none' }, bottomLeft: { display: 'none' }, bottomRight: { display: 'none' },
};
