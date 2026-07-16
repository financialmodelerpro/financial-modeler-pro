/**
 * Module7Deck.tsx (REFM Module 7: the IC Presentation Builder)
 *
 * The PowerPoint-style shell: slide navigator on the left, a 16:9 canvas in the
 * middle, properties on the right. It replaces the old form-plus-fixed-report
 * Module 7 entirely.
 *
 * The data path, which is the whole point of the rebuild:
 *
 *   module1-store  ->  HydrateSnapshot  ->  computeFinancialsSnapshot
 *                                       ->  computeReturnsSnapshot
 *                                       ->  buildICReportModel  ->  ICReportModel
 *                                                                        |
 *   Deck (slides of objects holding BINDING KEYS) --------- resolved against it
 *
 * Nothing computed is ever stored on a slide, so there is no sync step and no
 * cache to invalidate: when Modules 1-6 change, the store changes, the snapshot
 * recomputes, and every bound object on every slide re-resolves on the next
 * render. That is what makes "the presentation updates automatically" true by
 * construction rather than by a refresh button.
 *
 * The deck pins to the Management base case by DEFAULT (settings.deckCase), so a
 * board deck does not silently change its numbers because someone switched the
 * topbar to a downside case. It is switchable to follow the active case.
 *
 * Phase 1 scope: the deck seeds, persists, and renders live model data on all
 * eighteen slides, read-only. Direct manipulation (drag / resize / snap / inline
 * text) is Phase 2 and slots into the hooks already threaded through
 * SlideCanvas; the Insert menu and full properties editors are Phase 3; export
 * is Phase 4.
 *
 * No em dashes in this file.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { buildICReportModel, type ICReportModel } from '../../lib/reports/icReport';
import { buildCaseComparisonReport } from '../../lib/reports/caseComparisonReport';
import { getReportInputs, getReportDeck, saveReportDeck, resetReportDeck, listParties } from '../../lib/persistence/client';
import { icMoneyScaleSpec, type ReportInputs } from '../../lib/reportInputs';
import type { Party } from '../../lib/parties';
import { makeDeckFmt } from '../../lib/reports/deck/bindings';
import { seedDeck, TEMPLATE_BY_ID } from '../../lib/reports/deck/templates';
import type { Deck, Slide } from '../../lib/reports/deck/types';
import { DECK_THEME } from '../../lib/reports/deck/theme';
import SlideCanvas from './deck/SlideCanvas';
import type { RenderCtx } from './deck/SlideObjectView';

// ── Small UI atoms, styled to the platform's navy system ────────────────────

const btn = (variant: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 4,
  cursor: 'pointer',
  border: `1px solid ${variant === 'primary' ? DECK_THEME.navy : DECK_THEME.rule}`,
  background: variant === 'primary' ? DECK_THEME.navy : variant === 'danger' ? '#FFF5F5' : '#FFFFFF',
  color: variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? DECK_THEME.red : DECK_THEME.ink,
  whiteSpace: 'nowrap',
});

function Banner({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }): React.JSX.Element {
  const c = tone === 'warn' ? { bg: '#FFF8E8', bd: '#E4C271', fg: '#7A5B12' } : { bg: '#EEF3F9', bd: DECK_THEME.pale, fg: DECK_THEME.navy };
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 4,
      padding: '8px 12px', fontSize: 12, lineHeight: 1.4,
    }}>
      {children}
    </div>
  );
}

// ── The module ──────────────────────────────────────────────────────────────

export default function Module7Deck({ activeProjectId = null }: { activeProjectId?: string | null } = {}): React.JSX.Element {
  const s = useModule1Store(useShallow((st) => ({
    project: st.project, phases: st.phases, parcels: st.parcels, landAllocationMode: st.landAllocationMode,
    assets: st.assets, subUnits: st.subUnits, costLines: st.costLines, costOverrides: st.costOverrides,
    financingTranches: st.financingTranches, equityContributions: st.equityContributions,
    migrationsApplied: st.migrationsApplied, cases: st.cases, activeCaseId: st.activeCaseId,
    baseSnapshot: st.baseSnapshot,
  })));

  const [inputs, setInputs] = useState<ReportInputs | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [canSave, setCanSave] = useState(true);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canvasW, setCanvasW] = useState(880);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  const asOf = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ── The model. Identical calls to the ones the Returns tab makes, so the deck
  //    can never show a different number from the rest of the platform.
  const liveModel = useMemo<HydrateSnapshot>(() => ({
    project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
    assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions,
    migrationsApplied: s.migrationsApplied, cases: s.cases, activeCaseId: s.activeCaseId,
  }) as HydrateSnapshot, [s]);

  const baseModel = useMemo<HydrateSnapshot>(() => (s.baseSnapshot ?? liveModel) as HydrateSnapshot, [s.baseSnapshot, liveModel]);

  const deckCase = deck?.settings.deckCase ?? 'management';
  const sourceModel = deckCase === 'active' ? liveModel : baseModel;

  const scenarios = useMemo(() => {
    if (!s.cases || s.cases.length <= 1) return null;
    return buildCaseComparisonReport({ baseModel, cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: liveModel });
  }, [s.cases, s.activeCaseId, baseModel, liveModel]);

  const model: ICReportModel | null = useMemo(() => {
    if (!s.project) return null;
    try {
      const snap = computeFinancialsSnapshot(sourceModel as never);
      const rs = computeReturnsSnapshot(snap, sourceModel.project);
      return buildICReportModel({
        project: sourceModel.project, phases: sourceModel.phases, assets: sourceModel.assets,
        subUnits: sourceModel.subUnits, rs, snap, parties, asOf, scenarios, cases: s.cases,
      });
    } catch {
      return null;
    }
  }, [sourceModel, parties, asOf, scenarios, s.cases, s.project]);

  const fmt = useMemo(() => {
    const scale = deck?.settings.moneyScale ?? 'millions';
    return makeDeckFmt(icMoneyScaleSpec(scale, s.project?.currency ?? 'SAR'));
  }, [deck?.settings.moneyScale, s.project?.currency]);

  // ── Load: report inputs (the seed source) + parties, then the deck.
  useEffect(() => {
    if (!activeProjectId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    void (async () => {
      const [ri, pr] = await Promise.all([getReportInputs(activeProjectId), listParties(activeProjectId)]);
      if (!alive) return;
      setInputs(ri.data?.inputs ?? null);
      setParties(pr.data?.parties ?? []);
      const dr = await getReportDeck(activeProjectId);
      if (!alive) return;
      setCanSave(dr.data?.canSave ?? true);
      setDeck(dr.data?.deck ?? null); // null = seed once the model is ready
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [activeProjectId]);

  // ── Seed on first open. Only when there is genuinely no saved deck, so a user's
  //    arrangement is never overwritten by a reseed.
  useEffect(() => {
    if (loading || deck || !model || !activeProjectId) return;
    setDeck(seedDeck(activeProjectId, model, { inputs }, { asOf }));
    setDirty(true);
  }, [loading, deck, model, activeProjectId, inputs, asOf]);

  useEffect(() => {
    if (deck && !activeSlideId) setActiveSlideId(deck.slides[0]?.id ?? null);
  }, [deck, activeSlideId]);

  // Fit the canvas to its column.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasW(Math.max(360, el.clientWidth - 48)));
    ro.observe(el);
    setCanvasW(Math.max(360, el.clientWidth - 48));
    return () => ro.disconnect();
  }, [loading]);

  const patchDeck = useCallback((fn: (d: Deck) => Deck) => {
    setDeck((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!activeProjectId || !deck) return;
    setSaving(true);
    setNotice(null);
    const res = await saveReportDeck(activeProjectId, deck);
    setSaving(false);
    if (res.error) { setNotice(res.error); return; }
    setDirty(false);
    setNotice('Presentation saved.');
  }, [activeProjectId, deck]);

  const reseed = useCallback(async () => {
    if (!activeProjectId || !model) return;
    await resetReportDeck(activeProjectId);
    const fresh = seedDeck(activeProjectId, model, { inputs }, { asOf });
    setDeck(fresh);
    setActiveSlideId(fresh.slides[0]?.id ?? null);
    setDirty(true);
    setNotice('Rebuilt from the slide library. Save to keep it.');
  }, [activeProjectId, model, inputs, asOf]);

  const toggleHidden = useCallback((id: string) => {
    patchDeck((d) => ({ ...d, slides: d.slides.map((sl) => (sl.id === id ? { ...sl, hidden: !sl.hidden } : sl)) }));
  }, [patchDeck]);

  const setDeckCase = useCallback((v: 'management' | 'active') => {
    patchDeck((d) => ({ ...d, settings: { ...d.settings, deckCase: v } }));
  }, [patchDeck]);

  const setScale = useCallback((v: 'millions' | 'thousands') => {
    patchDeck((d) => ({ ...d, settings: { ...d.settings, moneyScale: v } }));
  }, [patchDeck]);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!activeProjectId) {
    return (
      <div data-testid="m7-no-project" style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>
        Open a project to build its Investment Committee presentation.
      </div>
    );
  }
  if (loading) {
    return <div style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>Loading presentation...</div>;
  }
  if (!model) {
    return (
      <div style={{ padding: 32 }}>
        <Banner tone="warn">
          This project has no computed model yet. Complete Modules 1 to 5 and the presentation will build itself from them.
        </Banner>
      </div>
    );
  }
  if (!deck) {
    return <div style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>Building the deck...</div>;
  }

  const activeSlide: Slide | null = deck.slides.find((sl) => sl.id === activeSlideId) ?? deck.slides[0] ?? null;
  const ctx: RenderCtx = { model, fmt, branding: deck.branding };
  const visibleSlides = deck.slides.filter((sl) => !sl.hidden);
  const pageNumberOf = (sl: Slide): number => visibleSlides.findIndex((v) => v.id === sl.id) + 1;

  return (
    <div data-testid="module7-deck" style={{ display: 'grid', gridTemplateColumns: '212px 1fr 268px', height: 'calc(100vh - 190px)', minHeight: 560, background: DECK_THEME.offWhite, borderTop: `1px solid ${DECK_THEME.rule}` }}>

      {/* ── Left: slide navigator ───────────────────────────────────────── */}
      <aside data-testid="deck-navigator" style={{ borderRight: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', overflowY: 'auto', padding: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: DECK_THEME.slate, marginBottom: 8 }}>
          Slides ({deck.slides.length})
        </div>
        {deck.slides.map((sl, i) => {
          const active = sl.id === activeSlide?.id;
          return (
            <div
              key={sl.id}
              data-testid="deck-nav-item"
              onClick={() => { setActiveSlideId(sl.id); setSelectedId(null); }}
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', padding: 6, borderRadius: 4, cursor: 'pointer',
                background: active ? '#EEF3F9' : 'transparent',
                border: `1px solid ${active ? DECK_THEME.navy : 'transparent'}`,
                marginBottom: 6, opacity: sl.hidden ? 0.45 : 1,
              }}
            >
              <div style={{ fontSize: 9, color: DECK_THEME.slateLight, width: 14, textAlign: 'right', paddingTop: 2, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ border: `1px solid ${DECK_THEME.rule}`, background: '#FFF', flexShrink: 0 }}>
                <SlideCanvas slide={sl} deck={deck} model={model} ctx={ctx} pageNumber={pageNumberOf(sl)} width={124} thumbnail />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: DECK_THEME.ink, lineHeight: 1.3, wordBreak: 'break-word' }}>{sl.title}</div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleHidden(sl.id); }}
                  style={{ marginTop: 3, fontSize: 9, color: DECK_THEME.slateLight, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  {sl.hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 8, fontSize: 10, color: DECK_THEME.slateLight, lineHeight: 1.4 }}>
          Reorder, duplicate and blank slides arrive with the editing pass.
        </div>
      </aside>

      {/* ── Centre: the canvas ──────────────────────────────────────────── */}
      <main ref={canvasWrapRef} style={{ overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btn('primary')} onClick={() => void save()} disabled={saving || !dirty || !canSave} data-testid="deck-save">
            {saving ? 'Saving...' : dirty ? 'Save presentation' : 'Saved'}
          </button>
          <button style={btn()} onClick={() => void reseed()} data-testid="deck-reseed">Rebuild from library</button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: DECK_THEME.slate }}>Case</span>
          <select value={deck.settings.deckCase} onChange={(e) => setDeckCase(e.target.value as 'management' | 'active')} style={{ ...btn(), padding: '6px 8px' }}>
            <option value="management">Management (base)</option>
            <option value="active">Follow active case</option>
          </select>
          <span style={{ fontSize: 10, color: DECK_THEME.slate }}>Units</span>
          <select value={deck.settings.moneyScale} onChange={(e) => setScale(e.target.value as 'millions' | 'thousands')} style={{ ...btn(), padding: '6px 8px' }}>
            <option value="millions">Millions</option>
            <option value="thousands">Thousands</option>
          </select>
        </div>

        {!canSave ? (
          <div style={{ width: '100%' }}>
            <Banner tone="warn">
              Migration 199 has not been applied to this database yet, so the presentation cannot be saved. Everything else works: the deck is built live from your model each time you open it.
            </Banner>
          </div>
        ) : null}
        {notice ? <div style={{ width: '100%' }}><Banner tone="info">{notice}</Banner></div> : null}

        {activeSlide ? (
          <SlideCanvas
            slide={activeSlide}
            deck={deck}
            model={model}
            ctx={ctx}
            pageNumber={pageNumberOf(activeSlide)}
            width={canvasW}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : null}
      </main>

      {/* ── Right: properties ───────────────────────────────────────────── */}
      <aside data-testid="deck-properties" style={{ borderLeft: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', overflowY: 'auto', padding: 14 }}>
        <PropertiesPanel deck={deck} slide={activeSlide} selectedId={selectedId} model={model} />
      </aside>
    </div>
  );
}

// ── Properties panel ────────────────────────────────────────────────────────
// Phase 1 reports what a selected object IS and what it is linked to. The
// editors land in Phase 3; showing the live binding now is what lets a user
// confirm the auto-sync is real rather than take it on trust.

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: `1px solid ${DECK_THEME.rule}`, fontSize: 11 }}>
      <span style={{ color: DECK_THEME.slate, flexShrink: 0 }}>{label}</span>
      <span style={{ color: DECK_THEME.ink, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: DECK_THEME.slate, margin: '14px 0 6px' }}>
      {children}
    </div>
  );
}

function PropertiesPanel({ deck, slide, selectedId, model }: { deck: Deck; slide: Slide | null; selectedId: string | null; model: ICReportModel }): React.JSX.Element {
  const obj = slide?.objects.find((o) => o.id === selectedId) ?? null;

  const bindingOf = (o: NonNullable<typeof obj>): string | null => {
    switch (o.type) {
      case 'kpi':   return o.metric;
      case 'chart': return o.chart;
      case 'table': return o.table;
      case 'text':  return o.binding ?? null;
      case 'gantt': return 'programme.lanes';
      case 'heatmap': return 'sensitivity.irr';
      default: return null;
    }
  };

  if (!obj) {
    return (
      <>
        <SectionLabel>Slide</SectionLabel>
        {slide ? (
          <>
            <Row label="Title" value={slide.title} />
            <Row label="Layout" value={slide.templateId ? (TEMPLATE_BY_ID[slide.templateId]?.group ?? slide.templateId) : 'Custom'} />
            <Row label="Chrome" value={slide.chrome} />
            <Row label="Objects" value={slide.objects.length} />
            <Row label="Linked" value={slide.objects.filter((o) => ['kpi', 'chart', 'table', 'gantt', 'heatmap'].includes(o.type)).length} />
          </>
        ) : <div style={{ fontSize: 11, color: DECK_THEME.slate }}>No slide selected.</div>}

        <SectionLabel>Deck</SectionLabel>
        <Row label="Slides" value={deck.slides.length} />
        <Row label="Case" value={deck.settings.deckCase === 'active' ? 'Active case' : 'Management base'} />
        <Row label="Units" value={deck.settings.moneyScale} />
        <Row label="Source" value={model.cover.projectName} />

        <div style={{ marginTop: 16, fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.5 }}>
          Click any object on the slide to inspect what it is linked to. Every number you see is read live from Modules 1 to 6, never typed in.
        </div>
      </>
    );
  }

  const binding = bindingOf(obj);
  return (
    <>
      <SectionLabel>Selected object</SectionLabel>
      <Row label="Type" value={obj.type} />
      <Row label="Position" value={`${Math.round(obj.x)}, ${Math.round(obj.y)}`} />
      <Row label="Size" value={`${Math.round(obj.w)} x ${Math.round(obj.h)}`} />
      {obj.rot ? <Row label="Rotation" value={`${obj.rot}°`} /> : null}
      {obj.locked ? <Row label="Locked" value="Yes" /> : null}

      <SectionLabel>Model link</SectionLabel>
      {binding ? (
        <>
          <Row label="Bound to" value={<code style={{ fontSize: 10 }}>{binding}</code>} />
          <div style={{ marginTop: 8, padding: 8, background: '#EEF3F9', borderRadius: 4, fontSize: 10, color: DECK_THEME.navy, lineHeight: 1.5 }}>
            This object reads from the model on every render. Change the assumption in Modules 1 to 6 and it updates here, in the PowerPoint export, and in the PDF.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.5 }}>
          Static content. Edit it directly on the slide once the editing pass lands.
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10, color: DECK_THEME.slateLight, lineHeight: 1.5 }}>
        Formatting, rebinding and Generate Commentary arrive with the properties pass.
      </div>
    </>
  );
}
