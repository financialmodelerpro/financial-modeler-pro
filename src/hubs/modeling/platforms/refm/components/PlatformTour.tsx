'use client';

/**
 * PlatformTour.tsx (2026-08-20)
 *
 * The step-through guided tour. Renders the steps built by lib/guide/tour.ts,
 * which derives every sentence from guideContent.ts, the same source the
 * written guide renders; this component owns ONLY the mechanics (spotlight,
 * card, navigation, persistence) and no content.
 *
 * Mechanics worth knowing:
 *
 *   NAVIGATION uses the existing 'fmp:trace-to' event, the same plumbing the
 *   statement trace-to-source arrows use, so the tour switches module and tab
 *   without a second navigation pathway to keep in step.
 *
 *   THE SPOTLIGHT is one absolutely positioned div over the target with a
 *   huge box-shadow doing the dimming, so the highlighted element stays at
 *   full brightness while everything else drops back. Anchors resolve through
 *   a fallback chain and a short retry, because a tab surface renders a tick
 *   after the navigation event; a step whose anchors all fail renders a
 *   centred card with no spotlight rather than dying.
 *
 *   STATE is persisted through lib/guide/tourState.ts on every step change
 *   and on every exit reason, so pause genuinely means resume-later, on any
 *   machine once mig 217 is applied.
 *
 * Palette: design-system tokens only. The dim layer uses the same
 * color-mix(heading) treatment every modal backdrop in the platform uses.
 *
 * No em dashes in this file.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TourStep, TourMode } from '../lib/guide/tour';
import { saveTourState } from '../lib/guide/tourState';

/**
 * IS THE RENDERED SURFACE EMPTY? Read off the actual DOM, never a list of
 * tabs that are "usually empty": such a list is a guess that goes stale the
 * day a tab changes. Two signals, both from the surface itself:
 *
 *   1. The platform declares it: a project-less surface renders a
 *      placeholder whose data-testid ends "-no-project".
 *
 *   2. Substance: a data-bearing tab renders tables and inputs by
 *      construction; a blank one renders a sentence and a button. Fewer
 *      than three such elements AND almost no text reads as blank.
 *
 * Used only to SKIP a step, and only after two consecutive reads agree
 * (see the resolve effect), so a surface still rendering is not mistaken
 * for an empty one.
 */
function surfaceIsEmpty(main: Element): boolean {
  if (main.querySelector('[data-testid$="-no-project"]')) return true;
  const substance = main.querySelectorAll('table, input, select, textarea').length;
  const text = ((main as HTMLElement).innerText ?? '').trim();
  return substance < 3 && text.length < 160;
}
const CARD_W = 380;
const PAD = 8;

interface Props {
  open: boolean;
  /** 'module' when no project is open: the builder emits no tab steps. */
  mode: TourMode;
  steps: TourStep[];
  initialStep?: number;
  /** paused: keep the resume position. skipped / completed: never auto-run again. */
  onClose: (reason: 'paused' | 'skipped' | 'completed') => void;
}

export default function PlatformTour({ open, mode, steps, initialStep = 0, onClose }: Props): React.JSX.Element | null {
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, initialStep), Math.max(0, steps.length - 1)));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const retries = useRef(0);
  // Which way the user is travelling, so an empty surface is skipped ONWARD
  // when they pressed Next and BACKWARD when they pressed Back.
  const direction = useRef<1 | -1>(1);

  const step = steps[idx];

  // Navigate, then resolve the anchor. The retry exists because the surface a
  // step points at renders a tick after the navigation event fires.
  useEffect(() => {
    if (!open || !step) return;
    if (step.nav) {
      window.dispatchEvent(new CustomEvent('fmp:trace-to', { detail: { module: step.nav.module, tab: step.nav.tab } }));
    }
    retries.current = 0;
    setRect(null);
    let cancelled = false;
    const resolve = (): void => {
      if (cancelled) return;
      // A tab or surface step against an EMPTY rendered surface is skipped in
      // the direction of travel, before any card shows: a spotlight on a
      // blank screen reads as an error, not a walkthrough. Two reads 200ms
      // apart must both say empty, so a surface still rendering is not
      // mistaken for a blank one.
      if (step.id.includes('/')) {
        const main = document.querySelector('[data-testid="platform-main"]');
        if (main && surfaceIsEmpty(main)) {
          window.setTimeout(() => {
            if (cancelled) return;
            const again = document.querySelector('[data-testid="platform-main"]');
            if (again && surfaceIsEmpty(again)) setIdx((i) => Math.min(Math.max(0, i + direction.current), steps.length - 1));
            else resolve();
          }, 200);
          return;
        }
      }
      for (const sel of step.anchors) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            el.scrollIntoView({ block: 'nearest' });
            setRect(el.getBoundingClientRect());
            return;
          }
        }
      }
      if (retries.current < 8) { retries.current += 1; window.setTimeout(resolve, 120); }
    };
    const t = window.setTimeout(resolve, step.nav ? 220 : 0);
    const onResize = (): void => { retries.current = 0; resolve(); };
    window.addEventListener('resize', onResize);
    return () => { cancelled = true; window.clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, [open, idx, step, steps.length]);

  const persist = useCallback((patch: { step?: number; completedAt?: string; skippedAt?: string; completedMode?: TourMode }): void => {
    saveTourState({ startedAt: new Date().toISOString(), step: idx, ...patch });
  }, [idx]);

  const go = useCallback((next: number): void => {
    direction.current = next >= idx ? 1 : -1;
    const clamped = Math.min(Math.max(0, next), steps.length - 1);
    setIdx(clamped);
    persist({ step: clamped });
  }, [idx, steps.length, persist]);

  const finish = useCallback((): void => { persist({ completedAt: new Date().toISOString(), completedMode: mode }); onClose('completed'); }, [persist, onClose, mode]);
  const skip = useCallback((): void => { persist({ skippedAt: new Date().toISOString() }); onClose('skipped'); }, [persist, onClose]);
  const pause = useCallback((): void => { persist({}); onClose('paused'); }, [persist, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { pause(); }
      else if (e.key === 'ArrowRight') { if (idx < steps.length - 1) go(idx + 1); else finish(); }
      else if (e.key === 'ArrowLeft' && idx > 0) { go(idx - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, steps.length, go, finish, pause]);

  if (!open || !step || typeof document === 'undefined') return null;

  const last = idx === steps.length - 1;

  // Card placement: below the target when there is room, above otherwise,
  // clamped into the viewport; centred when there is no spotlight.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 12 + 220 < vh;
    cardStyle = {
      position: 'fixed',
      left: Math.min(Math.max(12, rect.left), Math.max(12, vw - CARD_W - 12)),
      ...(below ? { top: Math.min(rect.bottom + 12, vh - 240) } : { bottom: Math.min(vh - rect.top + 12, vh - 60) }),
      width: CARD_W,
    };
  } else {
    cardStyle = { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: CARD_W + 40 };
  }

  const btn = (kind: 'primary' | 'plain' | 'quiet'): React.CSSProperties => ({
    fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
    border: kind === 'plain' ? '1px solid var(--color-border)' : 'none',
    background: kind === 'primary' ? 'var(--color-primary)' : kind === 'plain' ? 'var(--color-surface)' : 'none',
    color: kind === 'primary' ? 'var(--color-on-primary-navy)' : kind === 'plain' ? 'var(--color-heading)' : 'var(--color-meta)',
  });

  const content = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2100 }} data-testid="platform-tour" role="dialog" aria-modal="true">
      {rect ? (
        // The spotlight: the cutout stays interactive-looking while the huge
        // shadow dims everything around it. The overlay above blocks clicks so
        // a mid-tour click cannot half-edit the model.
        <div
          data-testid="tour-spotlight"
          style={{
            position: 'fixed',
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 10,
            border: '2px solid var(--color-primary)',
            boxShadow: '0 0 0 200vmax color-mix(in srgb, var(--color-heading) 55%, transparent)',
            pointerEvents: 'none',
            transition: 'left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--color-heading) 55%, transparent)' }} />
      )}

      {(rect !== null || step.anchors.length === 0) && (
      <div
        data-testid="tour-card"
        style={{
          ...cardStyle,
          background: 'var(--color-surface)', borderRadius: 12, boxShadow: 'var(--shadow-modal)',
          padding: '16px 18px', fontFamily: 'Inter, sans-serif', zIndex: 2101,
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', color: 'var(--color-meta)', textTransform: 'uppercase', marginBottom: 5 }} data-testid="tour-progress">
          Step {idx + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-heading)', marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text)', marginBottom: 14 }}>{step.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" style={btn('quiet')} onClick={skip} data-testid="tour-skip" title="Skip the tour. It will not run again; restart it any time from the Guide.">Skip tour</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" style={btn('plain')} onClick={pause} data-testid="tour-pause" title="Close and keep your place; the tour resumes here next time.">Pause</button>
            {idx > 0 && <button type="button" style={btn('plain')} onClick={() => go(idx - 1)} data-testid="tour-back">Back</button>}
            <button type="button" style={btn('primary')} onClick={() => (last ? finish() : go(idx + 1))} data-testid="tour-next">
              {last ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}
