/**
 * SlideNavigator.tsx (REFM Module 7: the deck's slide rail)
 *
 * The left rail of the IC Presentation Builder. It was previously inlined in
 * Module7Deck as a horizontal flex row (index + thumbnail + title side by side)
 * inside a 214px aside, which left the title roughly 27px of width. At
 * fontSize 10 with `wordBreak: 'break-word'` that renders a slide name as a
 * ladder of two and three character fragments, which is the "vertical text"
 * the rail was reported for. The fix is structural, not typographic: the
 * thumbnail gets the full row width and the title sits on its own line beneath
 * it, so a name wraps as words on at most two lines.
 *
 * Reordering is a pointer-capture gesture on the row itself, deliberately
 * modelled on EditLayer: capture the pointer on pointerdown, track on
 * pointermove, release on pointerup, and keep every listener on the element.
 * Window listeners registered from an effect are what previously left the
 * canvas gestures dead for days when the effect's deps changed each render, so
 * the same mistake is not repeated here.
 *
 * The gesture never mutates deck data itself. It reports (from, to) and the
 * parent applies the existing `moveSlide` mutation through its own `commit`,
 * so a reorder is one undo step and one dirty flag, exactly like every other
 * deck edit, and it persists on the same Save.
 *
 * Orientation is a prop: the rail is a vertical column at normal widths and a
 * horizontal filmstrip when the shell gets narrow. The drop-index maths reads
 * whichever axis is in play, so one gesture serves both.
 *
 * No em dashes in this file.
 */

'use client';

import React, { useCallback, useRef, useState } from 'react';
import SlideCanvas from './SlideCanvas';
import type { RenderCtx } from './SlideObjectView';
import type { Deck, Slide } from '../../../lib/reports/deck/types';
import type { ICReportModel } from '../../../lib/reports/icReport';
import { DECK_THEME } from '../../../lib/reports/deck/theme';

/** Pointer travel before a press becomes a drag. Below this a press is a click,
 *  so selecting a slide by clicking it is untouched. */
const DRAG_THRESHOLD = 4;
/** Distance from the rail's edge at which a drag starts scrolling the rail. */
const AUTOSCROLL_EDGE = 48;
const AUTOSCROLL_STEP = 14;

export type NavOrientation = 'vertical' | 'horizontal';

/**
 * The thumbnail, memoised.
 *
 * A deck routinely carries eighteen or more slides, and every drag pointermove
 * updates the drop indicator. Without this the whole rail would re-render a
 * full SlideCanvas per slide per pointer event. `ctx` and `deck` keep stable
 * identities for the duration of a gesture (the drag state lives in this
 * component, so the parent does not re-render), which is what lets the memo
 * actually hold.
 */
const NavThumb = React.memo(function NavThumb({ slide, deck, model, ctx, pageNumber, width }: {
  slide: Slide; deck: Deck; model: ICReportModel; ctx: RenderCtx; pageNumber: number; width: number;
}): React.JSX.Element {
  return <SlideCanvas slide={slide} deck={deck} model={model} ctx={ctx} pageNumber={pageNumber} width={width} thumbnail />;
});

export interface SlideNavigatorProps {
  deck: Deck;
  model: ICReportModel;
  ctx: RenderCtx;
  activeSlideId: string | null;
  orientation: NavOrientation;
  /** Rendered width of each thumbnail in logical px. */
  thumbWidth: number;
  pageNumberOf: (s: Slide) => number;
  onSelect: (id: string) => void;
  /** Indices into `deck.slides`, already normalised for the splice. */
  onReorder: (from: number, to: number) => void;
  onAddSlide: () => void;
  onToggleHidden: (slide: Slide) => void;
  onDuplicate: (slide: Slide) => void;
  onDelete: (slide: Slide) => void;
  onMove: (from: number, to: number) => void;
}

interface DragState { from: number; startX: number; startY: number; active: boolean; to: number }

export default function SlideNavigator({
  deck, model, ctx, activeSlideId, orientation, thumbWidth, pageNumberOf,
  onSelect, onReorder, onAddSlide, onToggleHidden, onDuplicate, onDelete, onMove,
}: SlideNavigatorProps): React.JSX.Element {
  const horizontal = orientation === 'horizontal';
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  /** Insertion index in the ORIGINAL array, 0..n, from the pointer position.
   *  Bounded by the slide count rather than the ref array's length: deleting a
   *  slide leaves a longer refs array behind, and trusting its length would
   *  return a drop index past the end of the deck. */
  const dropIndexAt = useCallback((x: number, y: number, count: number): number => {
    const els = itemRefs.current;
    const p = horizontal ? x : y;
    for (let i = 0; i < count; i += 1) {
      const el = els[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      if (p < mid) return i;
    }
    return count;
  }, [horizontal]);

  /** Keep the rail moving when the drag reaches its edge. */
  const autoScroll = useCallback((x: number, y: number): void => {
    const el = listRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (horizontal) {
      if (x < r.left + AUTOSCROLL_EDGE) el.scrollLeft -= AUTOSCROLL_STEP;
      else if (x > r.right - AUTOSCROLL_EDGE) el.scrollLeft += AUTOSCROLL_STEP;
    } else {
      if (y < r.top + AUTOSCROLL_EDGE) el.scrollTop -= AUTOSCROLL_STEP;
      else if (y > r.bottom - AUTOSCROLL_EDGE) el.scrollTop += AUTOSCROLL_STEP;
    }
  }, [horizontal]);

  const beginDrag = (e: React.PointerEvent, index: number, slide: Slide): void => {
    // Never start a gesture from the row's own action buttons, and leave touch
    // alone so the rail still scrolls with a finger. Touch users reorder with
    // the Up / Down actions, which stay on the active row.
    if (e.button !== 0 || e.pointerType === 'touch') { onSelect(slide.id); return; }
    if ((e.target as HTMLElement).closest('button')) return;
    // Select on press, the way a slide rail is expected to behave, so a drag
    // and a click both leave the dragged slide selected.
    onSelect(slide.id);
    dragRef.current = { from: index, startX: e.clientX, startY: e.clientY, active: false, to: index };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unsupported: the drag still tracks while inside */ }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const g = dragRef.current;
    if (!g) return;
    if (!g.active) {
      if (Math.abs(e.clientX - g.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - g.startY) < DRAG_THRESHOLD) return;
      g.active = true;
    }
    e.preventDefault();
    autoScroll(e.clientX, e.clientY);
    const to = dropIndexAt(e.clientX, e.clientY, deck.slides.length);
    g.to = to;
    setDrag((cur) => (cur && cur.to === to && cur.from === g.from ? cur : { from: g.from, to }));
  };

  const endDrag = (e: React.PointerEvent): void => {
    const g = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    const el = e.currentTarget;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!g || !g.active) return; // a plain click: selection already happened on press
    // `to` is an insertion index in the pre-removal array, so a forward move
    // loses one slot once the dragged slide is spliced out.
    const dest = g.to > g.from ? g.to - 1 : g.to;
    if (dest !== g.from) onReorder(g.from, dest);
  };

  const gap = horizontal ? 8 : 6;

  return (
    <aside
      data-testid="deck-navigator"
      style={{
        borderRight: horizontal ? 'none' : `1px solid ${DECK_THEME.rule}`,
        borderBottom: horizontal ? `1px solid ${DECK_THEME.rule}` : 'none',
        background: '#FFFFFF', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: horizontal ? '8px 12px 6px' : '10px 12px 8px', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: DECK_THEME.slate }}>
          Slides ({deck.slides.length})
        </span>
        <button
          title="Add blank slide" data-testid="deck-add-slide" onClick={onAddSlide}
          style={{
            padding: '3px 9px', fontSize: 13, fontWeight: 700, lineHeight: 1.2, borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', color: DECK_THEME.navy,
          }}
        >+</button>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1, minHeight: 0, minWidth: 0, display: 'flex', gap,
          flexDirection: horizontal ? 'row' : 'column',
          overflowX: horizontal ? 'auto' : 'hidden',
          overflowY: horizontal ? 'hidden' : 'auto',
          padding: horizontal ? '0 12px 10px' : '0 10px 12px',
          alignItems: horizontal ? 'flex-start' : 'stretch',
        }}
      >
        {deck.slides.map((sl, i) => {
          const active = sl.id === activeSlideId;
          const isDragged = drag?.from === i;
          const showLineBefore = drag != null && drag.to === i;
          return (
            <React.Fragment key={sl.id}>
              {showLineBefore ? <DropLine horizontal={horizontal} /> : null}
              <div
                ref={(el) => { itemRefs.current[i] = el; }}
                data-testid="deck-nav-item"
                data-slide-index={i}
                onPointerDown={(e) => beginDrag(e, i, sl)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                title={sl.title}
                style={{
                  flexShrink: 0, width: horizontal ? thumbWidth + 16 : undefined,
                  padding: 6, borderRadius: 5, cursor: isDragged ? 'grabbing' : 'grab',
                  background: active ? DECK_THEME.paleWash : 'transparent',
                  border: `1px solid ${active ? DECK_THEME.navy : 'transparent'}`,
                  borderLeft: horizontal
                    ? `1px solid ${active ? DECK_THEME.navy : 'transparent'}`
                    : `3px solid ${active ? DECK_THEME.navy : 'transparent'}`,
                  opacity: isDragged ? 0.4 : sl.hidden ? 0.55 : 1,
                  transition: isDragged ? 'none' : 'background 120ms ease',
                }}
              >
                <div style={{ position: 'relative', lineHeight: 0 }}>
                  <div style={{ border: `1px solid ${active ? DECK_THEME.navy : DECK_THEME.rule}`, background: '#FFF', borderRadius: 2, overflow: 'hidden' }}>
                    <NavThumb slide={sl} deck={deck} model={model} ctx={ctx} pageNumber={pageNumberOf(sl)} width={thumbWidth} />
                  </div>
                  <span style={{
                    position: 'absolute', top: 3, left: 3, minWidth: 15, textAlign: 'center',
                    background: active ? DECK_THEME.navy : 'rgba(255,255,255,0.92)',
                    color: active ? '#FFFFFF' : DECK_THEME.slate,
                    border: `1px solid ${active ? DECK_THEME.navy : DECK_THEME.rule}`,
                    borderRadius: 3, fontSize: 9, fontWeight: 700, lineHeight: '13px', padding: '0 3px',
                  }}>{i + 1}</span>
                  {sl.hidden ? (
                    <span style={{
                      position: 'absolute', top: 3, right: 3, background: 'rgba(255,255,255,0.92)',
                      border: `1px solid ${DECK_THEME.rule}`, color: DECK_THEME.slate,
                      borderRadius: 3, fontSize: 8.5, fontWeight: 700, lineHeight: '13px', padding: '0 4px',
                      textTransform: 'uppercase', letterSpacing: 0.3,
                    }}>Hidden</span>
                  ) : null}
                </div>

                {/* The title now owns a full-width line of its own, so it wraps
                    as words rather than splitting into a vertical ladder. */}
                <div style={{
                  fontSize: 11, fontWeight: 600, color: active ? DECK_THEME.navy : DECK_THEME.ink,
                  lineHeight: 1.35, marginTop: 5, wordBreak: 'normal', overflowWrap: 'break-word',
                  display: '-webkit-box', WebkitLineClamp: horizontal ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{sl.title}</div>

                {/* Kept in the filmstrip too: Hide / Duplicate / Delete have no
                    other home, and Up / Down are the reorder path for touch,
                    which deliberately does not start a drag. */}
                {active ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    <NavAction label={sl.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); onToggleHidden(sl); }} />
                    <NavAction label="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicate(sl); }} />
                    {i > 0 ? <NavAction label="Up" onClick={(e) => { e.stopPropagation(); onMove(i, i - 1); }} /> : null}
                    {i < deck.slides.length - 1 ? <NavAction label="Down" onClick={(e) => { e.stopPropagation(); onMove(i, i + 1); }} /> : null}
                    {deck.slides.length > 1 ? <NavAction label="Delete" danger onClick={(e) => { e.stopPropagation(); onDelete(sl); }} /> : null}
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
        {drag != null && drag.to === deck.slides.length ? <DropLine horizontal={horizontal} /> : null}
      </div>

      {!horizontal ? (
        <div style={{ flexShrink: 0, padding: '6px 12px 9px', fontSize: 9.5, color: DECK_THEME.slateLight, lineHeight: 1.4, borderTop: `1px solid ${DECK_THEME.rule}` }}>
          Drag a slide to reorder it.
        </div>
      ) : null}
    </aside>
  );
}

/** The insertion marker shown between rows during a drag. */
function DropLine({ horizontal }: { horizontal: boolean }): React.JSX.Element {
  return (
    <div
      data-testid="deck-nav-dropline"
      style={horizontal
        ? { flexShrink: 0, alignSelf: 'stretch', width: 0, borderLeft: `2px solid ${DECK_THEME.navy}`, borderRadius: 2 }
        : { flexShrink: 0, height: 0, borderTop: `2px solid ${DECK_THEME.navy}`, borderRadius: 2 }}
    />
  );
}

function NavAction({ label, onClick, danger }: { label: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 9.5, color: danger ? DECK_THEME.red : DECK_THEME.slate, background: '#FFFFFF',
        border: `1px solid ${DECK_THEME.rule}`, borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
      }}
    >{label}</button>
  );
}
