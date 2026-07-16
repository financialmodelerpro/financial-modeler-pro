/**
 * SlideCanvas.tsx (REFM Module 7, IC Presentation Builder: the slide surface)
 *
 * Renders one slide at 1280x720 logical pixels and scales the whole thing with a
 * single CSS transform. Every child positions itself in logical px and stays
 * ignorant of the zoom, which is what keeps the canvas, the thumbnail rail and
 * the PPTX exporter reading from one set of coordinates.
 *
 * Slide chrome (header band, footer, page number) is painted here rather than
 * stored as objects, because it is deck-level furniture: it must not be
 * selectable, draggable or deletable per slide, and changing the branding has to
 * restyle all eighteen slides at once.
 *
 * Phase 1 renders read-only. The selection and drag layer lands in Phase 2; the
 * hooks it needs (onSelect, selectedId) are already threaded so that change is
 * additive rather than a rewrite.
 *
 * No em dashes in this file.
 */

'use client';

import React from 'react';
import type { ICReportModel } from '../../../lib/reports/icReport';
import type { Deck, DeckObject, Slide } from '../../../lib/reports/deck/types';
import { SLIDE_W, SLIDE_H, MARGIN, CONTENT_W } from '../../../lib/reports/deck/types';
import { DECK_THEME, fontFor, fontStack, TYPE_SCALE } from '../../../lib/reports/deck/theme';
import { FOOTER_Y } from '../../../lib/reports/deck/layout';
import { SlideObjectView, type RenderCtx } from './SlideObjectView';

export interface SlideCanvasProps {
  slide: Slide;
  deck: Deck;
  model: ICReportModel;
  ctx: RenderCtx;
  /** Slide number shown in the footer (1-based, cover included). */
  pageNumber: number;
  /** Rendered width in device px. The slide scales to fit it. */
  width: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Thumbnails skip chrome text and interaction for speed. */
  thumbnail?: boolean;
}

/** Deck-level chrome: the header band and footer. Not selectable objects. */
function Chrome({ deck, slide, pageNumber }: { deck: Deck; slide: Slide; pageNumber: number }): React.JSX.Element | null {
  if (slide.chrome === 'cover' || slide.chrome === 'blank') return null;
  const b = deck.branding;
  const body = fontStack(fontFor(b, 'body'));
  return (
    <>
      <div style={{
        position: 'absolute', left: MARGIN, top: 14, width: CONTENT_W, height: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: body, fontSize: TYPE_SCALE.chrome, color: DECK_THEME.slateLight, letterSpacing: 0.4,
      }}>
        <span>{b.whiteLabel ? b.companyName : b.headerText}</span>
        <span>{deck.title}</span>
      </div>
      <div style={{ position: 'absolute', left: MARGIN, top: FOOTER_Y - 10, width: CONTENT_W, height: 1, background: DECK_THEME.rule }} />
      <div style={{
        position: 'absolute', left: MARGIN, top: FOOTER_Y, width: CONTENT_W, height: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: body, fontSize: TYPE_SCALE.chrome, color: DECK_THEME.slateLight,
      }}>
        <span>{b.footerText}</span>
        {b.showSlideNumbers ? <span>{pageNumber}</span> : null}
      </div>
    </>
  );
}

/** One positioned object. Rotation is applied about the centre so a rotated box
 *  matches how PowerPoint anchors its own rotation. */
function Positioned({
  o, ctx, selected, onSelect, interactive,
}: {
  o: DeckObject; ctx: RenderCtx; selected: boolean; onSelect?: (id: string | null) => void; interactive: boolean;
}): React.JSX.Element {
  return (
    <div
      data-object-id={o.id}
      data-object-type={o.type}
      onMouseDown={interactive && !o.locked ? (e) => { e.stopPropagation(); onSelect?.(o.id); } : undefined}
      style={{
        position: 'absolute',
        left: o.x, top: o.y, width: o.w, height: o.h,
        transform: o.rot ? `rotate(${o.rot}deg)` : undefined,
        transformOrigin: 'center center',
        outline: selected ? `1.5px solid ${DECK_THEME.navy}` : undefined,
        outlineOffset: 1,
        cursor: interactive && !o.locked ? 'pointer' : 'default',
      }}
    >
      <SlideObjectView o={o} ctx={ctx} />
    </div>
  );
}

export default function SlideCanvas({
  slide, deck, ctx, pageNumber, width, selectedId = null, onSelect, thumbnail = false,
}: SlideCanvasProps): React.JSX.Element {
  const scale = width / SLIDE_W;
  const interactive = !thumbnail;

  return (
    <div
      data-testid={thumbnail ? 'deck-slide-thumb' : 'deck-slide-canvas'}
      style={{ width, height: SLIDE_H * scale, position: 'relative', flexShrink: 0 }}
    >
      <div
        onMouseDown={interactive ? () => onSelect?.(null) : undefined}
        style={{
          width: SLIDE_W, height: SLIDE_H, position: 'absolute', top: 0, left: 0,
          transform: `scale(${scale})`, transformOrigin: 'top left',
          background: slide.background ?? DECK_THEME.canvas,
          boxShadow: thumbnail ? 'none' : '0 2px 18px rgba(13,46,90,0.13)',
          overflow: 'hidden',
        }}
      >
        <Chrome deck={deck} slide={slide} pageNumber={pageNumber} />
        {slide.objects.map((o) => (
          <Positioned
            key={o.id}
            o={o}
            ctx={ctx}
            selected={!thumbnail && o.id === selectedId}
            onSelect={onSelect}
            interactive={interactive}
          />
        ))}
      </div>
    </div>
  );
}
