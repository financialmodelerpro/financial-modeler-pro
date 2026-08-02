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
 * Nothing computed is ever stored on a slide, so when Modules 1-6 change the
 * store changes, the snapshot recomputes, and every bound object re-resolves on
 * the next render. "The presentation updates automatically" is true by
 * construction, not by a refresh button.
 *
 * Phase 2 adds direct manipulation on top of the Phase 1 renderer: drag, resize,
 * snap-to-grid with alignment guides, z-order, duplicate / delete, inline text
 * editing, a full undo history, and editable properties. The visual renderer
 * (SlideCanvas) stays read-only; all interaction lives in EditLayer, and every
 * structural change goes through the pure helpers in mutations.ts so undo is a
 * stack of whole-deck snapshots.
 *
 * The deck pins to the Management base case by DEFAULT (settings.deckCase), so a
 * board deck does not silently change its numbers because someone switched the
 * topbar case. It is switchable to follow the active case.
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
import { getReportInputs, getReportDeck, saveReportDeck, resetReportDeck, listParties, exportReportDeck, getIcNarrativeStatus } from '../../lib/persistence/client';
import { NarrativeAiBoundary, NarrativeAiPanel, NarrativeReviewModal, type NarrativeAiStatus, type NarrativeDraft } from './deck/NarrativeAi';
import { buildNarrativePatch } from '../../lib/reports/deck/narrativeTargets';
import { icMoneyScaleSpec, type ReportInputs } from '../../lib/reportInputs';
import type { Party } from '../../lib/parties';
import { makeDeckFmt, isPaginatedTable } from '../../lib/reports/deck/bindings';
import { seedDeck, TEMPLATE_BY_ID } from '../../lib/reports/deck/templates';
import { upgradeDeckLayout } from '../../lib/reports/deck/deckUpgrade';
import type { Deck, DeckLink, DeckObject, Slide, TableObject } from '../../lib/reports/deck/types';
import { DECK_THEME, FONT_CHOICES_DECK } from '../../lib/reports/deck/theme';
import {
  updateObject, updateObjects, removeObjects, duplicateObjects, reorderObjects, nudgeObjects,
  duplicateSlide, addBlankSlide, removeSlide, moveSlide, updateSlide, updateBranding, updateSettings, addBlock,
  type ObjectPatch, type ZDir,
} from '../../lib/reports/deck/mutations';
import { availableBlocks, BLOCK_SECTIONS, type BlockSpec } from '../../lib/reports/deck/blockLibrary';
import SlideCanvas from './deck/SlideCanvas';
import SlideNavigator from './deck/SlideNavigator';
import EditLayer from './deck/EditLayer';
import type { RenderCtx } from './deck/SlideObjectView';
import { SLIDE_W, SLIDE_H, DECK_SCHEMA_VERSION } from '../../lib/reports/deck/types';

// ── Small UI atoms, styled to the platform's navy system ────────────────────

const btn = (variant: 'primary' | 'ghost' | 'danger' = 'ghost', on = false): React.CSSProperties => ({
  padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
  border: `1px solid ${variant === 'primary' || on ? DECK_THEME.navy : DECK_THEME.rule}`,
  background: variant === 'primary' || on ? DECK_THEME.navy : variant === 'danger' ? '#FFF5F5' : '#FFFFFF',
  color: variant === 'primary' || on ? '#FFFFFF' : variant === 'danger' ? DECK_THEME.red : DECK_THEME.ink,
  whiteSpace: 'nowrap',
});
const iconBtn: React.CSSProperties = { ...btn(), padding: '6px 8px', minWidth: 30, textAlign: 'center' };

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function Banner({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }): React.JSX.Element {
  const c = tone === 'warn' ? { bg: '#FFF8E8', bd: '#E4C271', fg: '#7A5B12' } : { bg: '#EEF3F9', bd: DECK_THEME.pale, fg: DECK_THEME.navy };
  return <div style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 4, padding: '8px 12px', fontSize: 12, lineHeight: 1.4 }}>{children}</div>;
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presentMode, setPresentMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pptx' | 'pdf' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // AI drafting (Unit 8). `aiStatus` is a MIRROR of the server's answer, never a
  // local allowance: it is seeded from the status endpoint and refreshed from
  // the meter reading each generation returns.
  const [aiStatus, setAiStatus] = useState<NarrativeAiStatus | null>(null);
  const [aiDrafts, setAiDrafts] = useState<NarrativeDraft[]>([]);
  // Layout measurement.
  //
  // The platform shell runs at `zoom: 0.8` with `height: calc(100vh / 0.8)`, so
  // both `vh` units and viewport media queries lie inside it: `vh` still
  // resolves against the real viewport while the shell's own coordinate space
  // is 1.25x that. This module used to size itself `calc(100vh - 190px)`, which
  // is why it left a large blank band under the deck on tall screens. Nothing
  // here reads the viewport: the shell fills its parent and every breakpoint
  // comes from the measured element.
  const [rootW, setRootW] = useState(1400);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 1120, h: 620 });
  const [propsOpen, setPropsOpen] = useState(false);
  const rootRoRef = useRef<ResizeObserver | null>(null);
  const stageRoRef = useRef<ResizeObserver | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // Undo / redo: whole-deck snapshots.
  const [past, setPast] = useState<Deck[]>([]);
  const [future, setFuture] = useState<Deck[]>([]);
  const deckRef = useRef<Deck | null>(null);
  useEffect(() => { deckRef.current = deck; }, [deck]);

  const asOf = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ── The model. Identical calls to the Returns tab, so the deck never shows a
  //    different number from the rest of the platform.
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
      return buildICReportModel({ project: sourceModel.project, phases: sourceModel.phases, assets: sourceModel.assets, subUnits: sourceModel.subUnits, rs, snap, parties, asOf, scenarios, cases: s.cases });
    } catch { return null; }
  }, [sourceModel, parties, asOf, scenarios, s.cases, s.project]);

  const fmt = useMemo(() => {
    const scale = deck?.settings.moneyScale ?? 'millions';
    return makeDeckFmt(icMoneyScaleSpec(scale, s.project?.currency ?? 'SAR'));
  }, [deck?.settings.moneyScale, s.project?.currency]);

  // Insert Data Block picker: only blocks whose model data exists are offered,
  // so the library self-omits per project (no empty blocks).
  const blocks = useMemo<BlockSpec[]>(() => (model ? availableBlocks(model, fmt) : []), [model, fmt]);

  // ── Load report inputs (seed source) + parties, then the deck.
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
      setDeck(dr.data?.deck ?? null);
      setPast([]); setFuture([]);
      setLoading(false);
      // AI status last, and FAIL SOFT.
      //
      // The deck must render whether or not the AI feature is reachable, so
      // every failure mode here resolves to a null status, which hides the AI
      // section and leaves the editor untouched. The try/catch is not
      // redundant with the client wrapper's own error handling: the wrapper
      // returns an error result for a non-OK response, but a rejected promise
      // from anywhere in that chain would otherwise escape this effect and
      // surface as an unhandled error in the tab.
      try {
        const ai = await getIcNarrativeStatus(activeProjectId);
        if (!alive) return;
        setAiStatus(ai.data ?? null);
      } catch (err) {
        console.error('[ic-narrative-ui] AI status could not be read; the AI section stays hidden:', err);
        if (alive) setAiStatus(null);
      }
    })();
    return () => { alive = false; };
  }, [activeProjectId]);

  // ── Seed on first open only (never overwrite a saved arrangement).
  useEffect(() => {
    if (loading || deck || !model || !activeProjectId) return;
    setDeck(seedDeck(activeProjectId, model, { inputs }, { asOf }));
    setDirty(true);
  }, [loading, deck, model, activeProjectId, inputs, asOf]);

  // ── One-time layout upgrade: an EXISTING deck below the current schema version
  //    auto-gains the new template slides (Contents, Returns Calculation, the
  //    financial statements) on open, non-destructively. Runs once per session,
  //    only when both the deck and the model are ready.
  const upgradedRef = useRef(false);
  useEffect(() => {
    if (loading || !deck || !model || upgradedRef.current) return;
    if ((deck.schemaVersion ?? 1) >= DECK_SCHEMA_VERSION) { upgradedRef.current = true; return; }
    upgradedRef.current = true;
    const res = upgradeDeckLayout(deck, model, { inputs });
    setDeck(res.deck);
    if (res.changed) {
      setDirty(true);
      setNotice(`Added ${res.addedTitles.length} new slide${res.addedTitles.length === 1 ? '' : 's'}: ${res.addedTitles.join(', ')}.`);
    }
  }, [loading, deck, model, inputs]);

  useEffect(() => { if (deck && !activeSlideId) setActiveSlideId(deck.slides[0]?.id ?? null); }, [deck, activeSlideId]);

  // Callback refs rather than an effect: the measured elements mount only after
  // the loading / no-model / no-deck guards below have passed, so an effect
  // keyed on those flags is easy to get subtly wrong. A callback ref observes
  // exactly when the node appears and disconnects when it goes away.
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    rootRoRef.current?.disconnect();
    rootRoRef.current = null;
    if (!el) return;
    const read = () => setRootW(el.clientWidth);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    rootRoRef.current = ro;
    read();
  }, []);

  const setStageRef = useCallback((el: HTMLDivElement | null) => {
    stageRoRef.current?.disconnect();
    stageRoRef.current = null;
    canvasWrapRef.current = el;
    if (!el) return;
    const read = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    stageRoRef.current = ro;
    read();
  }, []);

  useEffect(() => () => { rootRoRef.current?.disconnect(); stageRoRef.current?.disconnect(); }, []);

  // ── History-aware mutation plumbing ───────────────────────────────────────
  const pushHistory = useCallback(() => {
    if (deckRef.current) setPast((p) => [...p.slice(-59), deckRef.current as Deck]);
    setFuture([]);
  }, []);

  /** A discrete, undoable change. */
  const commit = useCallback((fn: (d: Deck) => Deck) => {
    if (!deckRef.current) return;
    pushHistory();
    setDeck((d) => (d ? fn(d) : d));
    setDirty(true);
  }, [pushHistory]);

  /** Live change during a drag / resize (no history push; the gesture pushed once). */
  const live = useCallback((fn: (d: Deck) => Deck) => {
    setDeck((d) => (d ? fn(d) : d));
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length || !deckRef.current) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [deckRef.current as Deck, ...f.slice(0, 59)]);
      setDeck(prev); setDirty(true); setSelectedIds([]); setEditingId(null);
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length || !deckRef.current) return f;
      const next = f[0];
      setPast((p) => [...p.slice(-59), deckRef.current as Deck]);
      setDeck(next); setDirty(true); setSelectedIds([]); setEditingId(null);
      return f.slice(1);
    });
  }, []);

  const save = useCallback(async () => {
    if (!activeProjectId || !deck) return;
    setSaving(true); setNotice(null);
    const res = await saveReportDeck(activeProjectId, deck);
    setSaving(false);
    if (res.error) { setNotice(res.error); return; }
    setDirty(false); setNotice('Presentation saved.');
  }, [activeProjectId, deck]);

  const doExport = useCallback(async (format: 'pptx' | 'pdf') => {
    if (!activeProjectId || !deck || !model) return;
    setExportOpen(false); setExporting(format); setNotice(null);
    const res = await exportReportDeck(activeProjectId, {
      deck, model,
      scale: deck.settings.moneyScale,
      currency: s.project?.currency ?? 'SAR',
      format,
      fileName: deck.title,
    });
    setExporting(null);
    if (res.error || !res.data) { setNotice(res.error ?? 'Export failed.'); return; }
    const safe = (deck.title || 'Presentation').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Presentation';
    triggerDownload(`${safe}.${format}`, res.data);
    setNotice(`Exported ${format === 'pptx' ? 'PowerPoint' : 'PDF'}.`);
  }, [activeProjectId, deck, model, s.project?.currency]);

  const reseed = useCallback(async () => {
    if (!activeProjectId || !model) return;
    if (!window.confirm('Rebuild every slide from the library? This replaces your current arrangement (you can still undo).')) return;
    pushHistory();
    await resetReportDeck(activeProjectId);
    const fresh = seedDeck(activeProjectId, model, { inputs }, { asOf });
    setDeck(fresh); setActiveSlideId(fresh.slides[0]?.id ?? null); setSelectedIds([]); setDirty(true);
    setNotice('Rebuilt from the slide library. Save to keep it.');
  }, [activeProjectId, model, inputs, asOf, pushHistory]);

  const selectSlide = useCallback((id: string) => { setActiveSlideId(id); setSelectedIds([]); setEditingId(null); }, []);

  // ── Keyboard shortcuts (attached to the canvas column) ────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingId || presentMode) return;
    const mod = e.ctrlKey || e.metaKey;
    const sid = activeSlideId;
    if (!sid) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd' && selectedIds.length) {
      e.preventDefault();
      pushHistory();
      let newIds: string[] = [];
      setDeck((d) => { if (!d) return d; const r = duplicateObjects(d, sid, selectedIds); newIds = r.newIds; return r.deck; });
      setSelectedIds(newIds); setDirty(true);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
      e.preventDefault(); commit((d) => removeObjects(d, sid, selectedIds)); setSelectedIds([]); return;
    }
    if (e.key === 'Escape') { setSelectedIds([]); setEditingId(null); return; }
    if (mod && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      const dir: ZDir = e.key === ']' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward');
      commit((d) => reorderObjects(d, sid, selectedIds, dir)); return;
    }
    if (e.key.startsWith('Arrow') && selectedIds.length) {
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      commit((d) => nudgeObjects(d, sid, selectedIds, dx, dy));
    }
  }, [editingId, presentMode, activeSlideId, selectedIds, undo, redo, commit, pushHistory]);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!activeProjectId) return <div data-testid="m7-no-project" style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>Open a project to build its Investment Committee presentation.</div>;
  if (loading) return <div style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>Loading presentation...</div>;
  if (!model) return <div style={{ padding: 32 }}><Banner tone="warn">This project has no computed model yet. Complete Modules 1 to 5 and the presentation will build itself from them.</Banner></div>;
  if (!deck) return <div style={{ padding: 32, color: DECK_THEME.slate, fontSize: 13 }}>Building the deck...</div>;

  const activeSlide: Slide | null = deck.slides.find((sl) => sl.id === activeSlideId) ?? deck.slides[0] ?? null;
  const ctx: RenderCtx = { model, fmt, branding: deck.branding, preview: presentMode, onNavigate: selectSlide };
  const visibleSlides = deck.slides.filter((sl) => !sl.hidden);
  const pageNumberOf = (sl: Slide): number => visibleSlides.findIndex((v) => v.id === sl.id) + 1;
  // ── Responsive shape, from the measured shell width (not media queries) ────
  const mode: 'wide' | 'mid' | 'narrow' | 'compact' =
    rootW >= 1600 ? 'wide' : rootW >= 1100 ? 'mid' : rootW >= 820 ? 'narrow' : 'compact';
  const filmstrip = mode === 'compact';
  const navW = mode === 'wide' ? 248 : mode === 'mid' ? 216 : 200;
  const propsW = mode === 'wide' ? 300 : 280;
  // Wide and mid dock the properties panel; below that it becomes an overlay so
  // the slide keeps the width.
  const propsDocked = mode === 'wide' || mode === 'mid';
  const propsVisible = propsDocked || propsOpen;
  const navThumbW = filmstrip ? 150 : navW - 34;

  // ── Fit-to-BOX, the core sizing fix ───────────────────────────────────────
  // The old rule was width-only (`canvasW = column - 48`, height whatever fell
  // out), so the slide overflowed its column into an inner scrollbar on wide
  // screens and left the column's spare height unused on narrow ones. A 16:9
  // stage has to honour both axes.
  const STAGE_PAD = 28;
  const scale = Math.max(0.05, Math.min(
    (stage.w - STAGE_PAD * 2) / SLIDE_W,
    (stage.h - STAGE_PAD * 2) / SLIDE_H,
  ));
  const canvasW = SLIDE_W * scale;
  const canvasH = SLIDE_H * scale;
  const sid = activeSlide?.id ?? '';

  // Insert a picker block onto the active slide + select it (one history step).
  const insertBlock = (spec: BlockSpec) => {
    if (!sid) return;
    pushHistory();
    let nid = '';
    setDeck((d) => { if (!d) return d; const r = addBlock(d, sid, spec); nid = r.newId; return r.deck; });
    if (nid) setSelectedIds([nid]);
    setDirty(true);
    setPickerOpen(false);
  };

  const applyObjectPatch = (objId: string, patch: ObjectPatch) => commit((d) => updateObject(d, sid, objId, patch));

  /**
   * Apply reviewed drafts to their own slides.
   *
   * Each patch targets the slide the draft came from, NOT the active slide, so
   * Apply all works without walking the user through six slides. It goes
   * through `commit`, so it lands in the undo stack and marks the deck dirty:
   * an applied draft is an ordinary edit the user can undo, and it is still not
   * persisted until Save, which is what keeps "never auto-saved" true all the
   * way to the database.
   */
  //
  // NOT a hook, deliberately. This sits AFTER the early returns above (no
  // project / loading / no model / no deck), and a useCallback here runs on
  // some renders and not others, so React counts a different number of hooks
  // once the deck finishes loading and throws "Rendered more hooks than during
  // the previous render". That crashed the whole Presentation tab in
  // production, with the AI feature switched OFF, because the hook ran
  // regardless of the feature. A plain function has no hook order to get wrong,
  // and it matches applyObjectPatch directly above.
  const applyNarrativeDrafts = (drafts: NarrativeDraft[]) => {
    if (!drafts.length) return;
    commit((d) => drafts.reduce((acc, draft) => {
      const slide = acc.slides.find((s) => s.id === draft.target.slideId);
      const existing = slide?.objects.find((o) => o.id === draft.target.objectId) ?? null;
      const patch = buildNarrativePatch(draft.target, { draft: draft.draft, risks: draft.risks }, existing);
      return patch ? updateObject(acc, draft.target.slideId, draft.target.objectId, patch as ObjectPatch) : acc;
    }, d));
    setAiDrafts((cur) => cur.filter((c) => !drafts.some((d) => d.field === c.field)));
    setNotice(drafts.length === 1
      ? `Applied the ${drafts[0].label.toLowerCase()} draft. Save to keep it.`
      : `Applied ${drafts.length} drafts. Save to keep them.`);
  };

  return (
    <div
      ref={setRootRef}
      data-testid="module7-deck"
      style={{
        display: 'grid',
        gridTemplateColumns: filmstrip
          ? 'minmax(0,1fr)'
          : `${navW}px minmax(0,1fr)${propsDocked && propsVisible ? ` ${propsW}px` : ''}`,
        gridTemplateRows: filmstrip ? 'auto minmax(0,1fr)' : 'minmax(0,1fr)',
        height: '100%', minHeight: 0, position: 'relative',
        background: DECK_THEME.offWhite, borderTop: `1px solid ${DECK_THEME.rule}`,
      }}
    >

      {/* ── Left (or top, when narrow): slide navigator ─────────────────── */}
      <SlideNavigator
        deck={deck} model={model} ctx={ctx}
        activeSlideId={activeSlide?.id ?? null}
        orientation={filmstrip ? 'horizontal' : 'vertical'}
        thumbWidth={navThumbW}
        pageNumberOf={pageNumberOf}
        onSelect={selectSlide}
        onReorder={(from, to) => commit((d) => moveSlide(d, from, to))}
        onMove={(from, to) => commit((d) => moveSlide(d, from, to))}
        onAddSlide={() => { pushHistory(); let nid = ''; setDeck((d) => { if (!d) return d; const r = addBlankSlide(d, activeSlideId); nid = r.newId; return r.deck; }); setDirty(true); if (nid) selectSlide(nid); }}
        onToggleHidden={(sl) => commit((d) => updateSlide(d, sl.id, { hidden: !sl.hidden }))}
        onDuplicate={(sl) => { pushHistory(); let nid = ''; setDeck((d) => { if (!d) return d; const r = duplicateSlide(d, sl.id); nid = r.newId; return r.deck; }); setDirty(true); if (nid) selectSlide(nid); }}
        onDelete={(sl) => { commit((d) => removeSlide(d, sl.id)); if (activeSlideId === sl.id) setActiveSlideId(deck.slides.find((x) => x.id !== sl.id)?.id ?? null); }}
      />

      {/* ── Centre: a fixed control strip over a stage that owns the rest ── */}
      <main tabIndex={0} onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, outline: 'none' }}>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px', background: '#FFFFFF', borderBottom: `1px solid ${DECK_THEME.rule}` }}>
        <div style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btn('primary')} onClick={() => void save()} disabled={saving || !dirty || !canSave} data-testid="deck-save">{saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}</button>
          <span style={{ width: 1, height: 20, background: DECK_THEME.rule, margin: '0 2px' }} />
          <button style={iconBtn} title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.length} data-testid="deck-undo">↶</button>
          <button style={iconBtn} title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length} data-testid="deck-redo">↷</button>
          <span style={{ width: 1, height: 20, background: DECK_THEME.rule, margin: '0 2px' }} />
          <button style={iconBtn} title="Duplicate (Ctrl+D)" disabled={!selectedIds.length} onClick={() => { pushHistory(); let n: string[] = []; setDeck((d) => { if (!d) return d; const r = duplicateObjects(d, sid, selectedIds); n = r.newIds; return r.deck; }); setSelectedIds(n); setDirty(true); }}>⧉</button>
          <button style={iconBtn} title="Delete (Del)" disabled={!selectedIds.length} onClick={() => { commit((d) => removeObjects(d, sid, selectedIds)); setSelectedIds([]); }}>🗑</button>
          <button style={iconBtn} title="Bring forward (Ctrl+])" disabled={!selectedIds.length} onClick={() => commit((d) => reorderObjects(d, sid, selectedIds, 'forward'))}>▲</button>
          <button style={iconBtn} title="Send backward (Ctrl+[)" disabled={!selectedIds.length} onClick={() => commit((d) => reorderObjects(d, sid, selectedIds, 'backward'))}>▼</button>
          <span style={{ width: 1, height: 20, background: DECK_THEME.rule, margin: '0 2px' }} />
          <div style={{ position: 'relative' }}>
            <button style={btn('ghost', pickerOpen)} onClick={() => setPickerOpen((v) => !v)} disabled={presentMode || !sid} data-testid="deck-insert-block" title="Add a data block from your model onto this slide">+ Insert data ▾</button>
            {pickerOpen && !presentMode ? (
              <BlockPicker blocks={blocks} onPick={insertBlock} onClose={() => setPickerOpen(false)} />
            ) : null}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <button style={btn('ghost', exportOpen)} onClick={() => setExportOpen((v) => !v)} disabled={!!exporting} data-testid="deck-export">
              {exporting ? (exporting === 'pptx' ? 'Building PPTX...' : 'Building PDF...') : 'Export ▾'}
            </button>
            {exportOpen && !exporting ? (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#FFFFFF', border: `1px solid ${DECK_THEME.rule}`, borderRadius: 6, boxShadow: '0 6px 20px rgba(13,46,90,0.16)', zIndex: 20, minWidth: 208, padding: 6 }}>
                <ExportItem title="PowerPoint (.pptx)" desc="Fully editable, native shapes and charts" onClick={() => void doExport('pptx')} testid="deck-export-pptx" />
                <ExportItem title="PDF (.pdf)" desc="Shareable, print-ready, same layout" onClick={() => void doExport('pdf')} testid="deck-export-pdf" />
                <div style={{ fontSize: 10, color: DECK_THEME.slateLight, padding: '6px 8px 2px', lineHeight: 1.4 }}>Exports the live deck at the {deck.settings.moneyScale} scale. Every figure is read from your model.</div>
              </div>
            ) : null}
          </div>
          <button style={btn('ghost', presentMode)} onClick={() => { setPresentMode((v) => !v); setSelectedIds([]); setEditingId(null); }} data-testid="deck-present-toggle">{presentMode ? 'Editing off' : 'Preview'}</button>
          {/* Below the docked width the properties panel becomes an overlay, so
              it needs its own affordance. */}
          {!propsDocked ? (
            <button style={btn('ghost', propsOpen)} onClick={() => setPropsOpen((v) => !v)} data-testid="deck-props-toggle">{propsOpen ? 'Hide panel' : 'Properties'}</button>
          ) : null}
        </div>

        <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: DECK_THEME.slate }}>
          <span>Case</span>
          <select value={deck.settings.deckCase} onChange={(e) => commit((d) => updateSettings(d, { deckCase: e.target.value as 'management' | 'active' }))} style={{ ...btn(), padding: '5px 7px' }}>
            <option value="management">Management (base)</option>
            <option value="active">Follow active case</option>
          </select>
          <span>Units</span>
          <select value={deck.settings.moneyScale} onChange={(e) => commit((d) => updateSettings(d, { moneyScale: e.target.value as 'millions' | 'thousands' }))} style={{ ...btn(), padding: '5px 7px' }}>
            <option value="millions">Millions</option>
            <option value="thousands">Thousands</option>
          </select>
          <div style={{ flex: 1 }} />
          <button style={{ ...btn(), padding: '5px 8px' }} onClick={() => void reseed()} data-testid="deck-reseed">Rebuild from library</button>
        </div>

        {!canSave ? <div style={{ width: '100%' }}><Banner tone="warn">Migration 199 has not been applied yet, so the presentation cannot be saved. Everything else works: the deck is built live from your model.</Banner></div> : null}
        {notice ? <div style={{ width: '100%' }}><Banner tone="info">{notice}</Banner></div> : null}
        </div>

        {/* The stage takes every pixel the control strip did not, and the slide
            scales to FIT it on both axes. Nothing here scrolls: if the strip
            grows (a banner appears) the slide simply scales down. */}
        <div
          ref={setStageRef}
          data-testid="deck-stage"
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: STAGE_PAD, overflow: 'hidden' }}
        >
          {activeSlide ? (
            <div style={{ position: 'relative', width: canvasW, height: canvasH, flexShrink: 0, boxShadow: '0 6px 24px rgba(13,46,90,0.16)' }}>
              <SlideCanvas slide={activeSlide} deck={deck} model={model} ctx={ctx} pageNumber={pageNumberOf(activeSlide)} width={canvasW} interactive={false} />
              {!presentMode ? (
                <EditLayer
                  slide={activeSlide} branding={deck.branding} scale={scale} width={canvasW} height={canvasH}
                  selectedIds={selectedIds} editingId={editingId}
                  onSelect={setSelectedIds} onBeginEdit={setEditingId}
                  onGestureStart={pushHistory}
                  onTransform={(patches) => live((d) => updateObjects(d, sid, patches))}
                  onTextCommit={(id, value) => applyObjectPatch(id, typeof value === 'string' ? { text: value } : { items: value })}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ flexShrink: 0, padding: '6px 14px 8px', fontSize: 10, color: DECK_THEME.slateLight, borderTop: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF' }}>
          Drag to move, handles to resize, double-click text to edit. Arrows nudge, Ctrl+D duplicates, Ctrl+Z undoes.
        </div>
      </main>

      {/* ── Right: properties. Docked at wide and mid widths, an overlay below
             that so the slide never gives up the space. ─────────────────── */}
      {propsVisible ? (
      <aside
        data-testid="deck-properties"
        style={propsDocked
          ? { borderLeft: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', overflowY: 'auto', padding: 14, minHeight: 0 }
          : {
              position: 'absolute', top: 0, right: 0, bottom: 0, width: Math.min(propsW, Math.max(240, rootW - 60)),
              borderLeft: `1px solid ${DECK_THEME.rule}`, background: '#FFFFFF', overflowY: 'auto', padding: 14,
              boxShadow: '-8px 0 24px rgba(13,46,90,0.14)', zIndex: 15,
            }}
      >
        {/* AI drafting sits ABOVE the properties, and outside PropertiesPanel,
            so it stays reachable while an object is selected. Selecting a
            narrative block highlights its row rather than hiding the list. */}
        {model && !presentMode ? (
          <NarrativeAiBoundary>
            <SectionLabel>AI drafting</SectionLabel>
            <NarrativeAiPanel
              projectId={activeProjectId ?? ''}
              deck={deck}
              model={model}
              currency={s.project?.currency ?? 'SAR'}
              status={aiStatus}
              selectedObjectId={selectedIds.length === 1 ? selectedIds[0] : null}
              onStatusRefresh={(next) => setAiStatus((cur) => (cur ? { ...cur, ...next } : cur))}
              onDrafts={(d) => setAiDrafts((cur) => [...cur.filter((c) => !d.some((x) => x.field === c.field)), ...d])}
              onNotice={setNotice}
            />
          </NarrativeAiBoundary>
        ) : null}

        <PropertiesPanel
          deck={deck} slide={activeSlide} selectedIds={selectedIds} model={model}
          onObjectPatch={applyObjectPatch}
          onBrandingPatch={(patch) => commit((d) => updateBranding(d, patch))}
          onSlidePatch={(patch) => activeSlide && commit((d) => updateSlide(d, activeSlide.id, patch))}
        />
      </aside>
      ) : null}

      {/* The review step. A draft reaches a slide only through here. */}
      {aiDrafts.length ? (
        <NarrativeAiBoundary>
          <NarrativeReviewModal
            drafts={aiDrafts}
            onApply={applyNarrativeDrafts}
            onClose={() => setAiDrafts([])}
          />
        </NarrativeAiBoundary>
      ) : null}
    </div>
  );
}

function ExportItem({ title, desc, onClick, testid }: { title: string; desc: string; onClick: () => void; testid: string }): React.JSX.Element {
  return (
    <button
      onClick={onClick} data-testid={testid}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 4, padding: '7px 8px', cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#EEF3F9')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: DECK_THEME.navy }}>{title}</div>
      <div style={{ fontSize: 10, color: DECK_THEME.slate, marginTop: 1 }}>{desc}</div>
    </button>
  );
}

// ── Insert Data Block picker ─────────────────────────────────────────────────
// Lists only blocks whose model data exists (availableBlocks already filtered),
// grouped by kind. Clicking one drops it onto the active slide.
function BlockPicker({ blocks, onPick, onClose }: { blocks: BlockSpec[]; onPick: (spec: BlockSpec) => void; onClose: () => void }): React.JSX.Element {
  return (
    <div
      data-testid="deck-block-picker"
      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#FFFFFF', border: `1px solid ${DECK_THEME.rule}`, borderRadius: 6, boxShadow: '0 6px 20px rgba(13,46,90,0.16)', zIndex: 20, width: 300, maxHeight: 440, overflowY: 'auto', padding: 6 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: DECK_THEME.navy }}>Insert data block</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: DECK_THEME.slate }} title="Close">✕</button>
      </div>
      {blocks.length === 0 ? (
        <div style={{ fontSize: 11, color: DECK_THEME.slate, padding: '8px 10px', lineHeight: 1.5 }}>
          No model data blocks are available for this project yet. Complete more of Modules 1 to 6 and they will appear here.
        </div>
      ) : (
        BLOCK_SECTIONS.map((sec) => {
          const items = blocks.filter((b) => sec.kinds.includes(b.kind));
          if (!items.length) return null;
          return (
            <div key={sec.id} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: DECK_THEME.slateLight, textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 8px 3px' }}>
                {sec.title} ({items.length})
              </div>
              {items.map((b) => (
                <button
                  key={b.key}
                  data-testid={`deck-block-${b.key}`}
                  onClick={() => onPick(b)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 4, padding: '6px 8px', cursor: 'pointer', alignItems: 'baseline' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#EEF3F9')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 12, color: DECK_THEME.navy }}>{b.label}</span>
                  <span style={{ fontSize: 9.5, color: DECK_THEME.slateLight, whiteSpace: 'nowrap' }}>{b.group}</span>
                </button>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Properties panel ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: DECK_THEME.slate, margin: '14px 0 6px' }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 6, color: DECK_THEME.slate }}><span>{label}</span>{children}</label>;
}
const inp: React.CSSProperties = { border: `1px solid ${DECK_THEME.rule}`, borderRadius: 3, padding: '4px 6px', fontSize: 11, width: 90 };
const numInp: React.CSSProperties = { ...inp, width: 64 };

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): React.JSX.Element {
  return <Field label={label}><input type="number" value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} style={numInp} /></Field>;
}
function ToggleBtn({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }): React.JSX.Element {
  return <button onClick={onClick} style={{ ...btn('ghost', on), padding: '4px 8px', fontSize: 11 }}>{label}</button>;
}

interface PropsPanelProps {
  deck: Deck; slide: Slide | null; selectedIds: string[]; model: ICReportModel;
  onObjectPatch: (objId: string, patch: ObjectPatch) => void;
  onBrandingPatch: (patch: Partial<Deck['branding']>) => void;
  onSlidePatch: (patch: Partial<Slide>) => void;
}

function PropertiesPanel({ deck, slide, selectedIds, model, onObjectPatch, onBrandingPatch, onSlidePatch }: PropsPanelProps): React.JSX.Element {
  const obj = selectedIds.length === 1 ? slide?.objects.find((o) => o.id === selectedIds[0]) ?? null : null;

  if (obj) return (
    <ObjectEditor
      obj={obj}
      onPatch={(p) => onObjectPatch(obj.id, p)}
      slides={deck.slides.filter((s) => !s.hidden).map((s) => ({ id: s.id, title: s.title }))}
      currentSlideId={slide?.id ?? ''}
    />
  );

  if (selectedIds.length > 1) {
    return <><SectionLabel>Selection</SectionLabel><div style={{ fontSize: 12, color: DECK_THEME.ink }}>{selectedIds.length} objects selected.</div><div style={{ fontSize: 11, color: DECK_THEME.slate, marginTop: 8, lineHeight: 1.5 }}>Drag to move them together, or use the toolbar to align z-order, duplicate or delete. Select one object to edit its properties.</div></>;
  }

  // Nothing selected: slide + deck + brand controls.
  return (
    <>
      <SectionLabel>Slide</SectionLabel>
      {slide ? (
        <>
          <Field label="Title"><input value={slide.title} onChange={(e) => onSlidePatch({ title: e.target.value })} style={inp} /></Field>
          <div style={{ fontSize: 11, color: DECK_THEME.slate }}>Layout: {slide.templateId ? (TEMPLATE_BY_ID[slide.templateId]?.group ?? slide.templateId) : 'Custom'} · {slide.objects.length} objects</div>
        </>
      ) : <div style={{ fontSize: 11, color: DECK_THEME.slate }}>No slide selected.</div>}

      <SectionLabel>Brand controls</SectionLabel>
      <Field label="Header"><input value={deck.branding.headerText} onChange={(e) => onBrandingPatch({ headerText: e.target.value })} style={inp} /></Field>
      <Field label="Footer"><input value={deck.branding.footerText} onChange={(e) => onBrandingPatch({ footerText: e.target.value })} style={inp} /></Field>
      <Field label="Company"><input value={deck.branding.companyName} onChange={(e) => onBrandingPatch({ companyName: e.target.value })} style={inp} /></Field>
      <Field label="Headings"><FontSelect value={deck.branding.fontHeading} onChange={(v) => onBrandingPatch({ fontHeading: v })} /></Field>
      <Field label="Body"><FontSelect value={deck.branding.fontBody} onChange={(v) => onBrandingPatch({ fontBody: v })} /></Field>
      <Field label="Primary"><input type="color" value={deck.branding.primary ?? DECK_THEME.navy} onChange={(e) => onBrandingPatch({ primary: e.target.value })} style={{ ...inp, width: 44, padding: 2 }} /></Field>
      <Field label="Slide numbers"><input type="checkbox" checked={deck.branding.showSlideNumbers} onChange={(e) => onBrandingPatch({ showSlideNumbers: e.target.checked })} /></Field>
      <Field label="White label"><input type="checkbox" checked={deck.branding.whiteLabel} onChange={(e) => onBrandingPatch({ whiteLabel: e.target.checked })} /></Field>

      <div style={{ marginTop: 16, fontSize: 11, color: DECK_THEME.slate, lineHeight: 1.5 }}>Click any object to inspect and edit it. Every number is read live from Modules 1 to 6, never typed in.</div>
    </>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return <select value={value} onChange={(e) => onChange(e.target.value)} style={inp}>{FONT_CHOICES_DECK.map((f) => <option key={f} value={f}>{f}</option>)}</select>;
}

// ── Per-object editor ───────────────────────────────────────────────────────

/** Hyperlink editor: point any object at a slide (internal jump) or a web URL.
 *  The slide link stores an id and resolves to a page at export, so it survives
 *  reordering. Available on every object; the ToC also sets links per entry. */
function LinkEditor({ link, slides, currentSlideId, onChange }: {
  link: DeckLink | null | undefined; slides: Array<{ id: string; title: string }>; currentSlideId: string; onChange: (l: DeckLink | null) => void;
}): React.JSX.Element {
  const kind = link?.kind ?? 'none';
  const firstOther = slides.find((s) => s.id !== currentSlideId)?.id ?? slides[0]?.id ?? '';
  return (
    <>
      <SectionLabel>Hyperlink</SectionLabel>
      <Field label="Link to">
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'none') onChange(null);
            else if (v === 'slide') onChange({ kind: 'slide', slideId: firstOther });
            else onChange({ kind: 'url', href: '' });
          }}
          style={inp}
          data-testid="deck-link-kind"
        >
          <option value="none">None</option>
          <option value="slide">A slide</option>
          <option value="url">A web URL</option>
        </select>
      </Field>
      {link?.kind === 'slide' ? (
        <Field label="Slide">
          <select value={link.slideId} onChange={(e) => onChange({ kind: 'slide', slideId: e.target.value })} style={inp} data-testid="deck-link-slide">
            {slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
          </select>
        </Field>
      ) : null}
      {link?.kind === 'url' ? (
        <Field label="URL"><input placeholder="https://" value={link.href} onChange={(e) => onChange({ kind: 'url', href: e.target.value })} style={inp} /></Field>
      ) : null}
    </>
  );
}

function ObjectEditor({ obj, onPatch, slides, currentSlideId }: { obj: DeckObject; onPatch: (p: ObjectPatch) => void; slides: Array<{ id: string; title: string }>; currentSlideId: string }): React.JSX.Element {
  const style = (obj as { style?: import('../../lib/reports/deck/types').TextStyle }).style;
  const patchStyle = (p: Partial<import('../../lib/reports/deck/types').TextStyle>) => onPatch({ style: { ...(style ?? {}), ...p } });

  return (
    <>
      <SectionLabel>{obj.type}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <NumberField label="X" value={obj.x} onChange={(v) => onPatch({ x: v })} />
        <NumberField label="Y" value={obj.y} onChange={(v) => onPatch({ y: v })} />
        <NumberField label="W" value={obj.w} onChange={(v) => onPatch({ w: v })} />
        <NumberField label="H" value={obj.h} onChange={(v) => onPatch({ h: v })} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <ToggleBtn on={!!obj.locked} label={obj.locked ? 'Locked' : 'Lock'} onClick={() => onPatch({ locked: !obj.locked })} />
        <ToggleBtn on={!!obj.hidden} label={obj.hidden ? 'Hidden' : 'Hide'} onClick={() => onPatch({ hidden: !obj.hidden })} />
      </div>

      {(obj.type === 'text' || obj.type === 'bullets') && style ? (
        <>
          <SectionLabel>Text</SectionLabel>
          <NumberField label="Size" value={style.size} onChange={(v) => patchStyle({ size: v })} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <ToggleBtn on={!!style.bold} label="B" onClick={() => patchStyle({ bold: !style.bold })} />
            <ToggleBtn on={!!style.italic} label="I" onClick={() => patchStyle({ italic: !style.italic })} />
            <ToggleBtn on={!!style.underline} label="U" onClick={() => patchStyle({ underline: !style.underline })} />
          </div>
          <Field label="Align">
            <select value={style.align} onChange={(e) => patchStyle({ align: e.target.value as 'left' | 'center' | 'right' })} style={inp}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
          </Field>
          <Field label="Colour"><input type="color" value={style.color} onChange={(e) => patchStyle({ color: e.target.value })} style={{ ...inp, width: 44, padding: 2 }} /></Field>
          {obj.type === 'bullets' ? <Field label="Numbered"><input type="checkbox" checked={!!(obj as { numbered?: boolean }).numbered} onChange={(e) => onPatch({ numbered: e.target.checked })} /></Field> : null}
        </>
      ) : null}

      {obj.type === 'kpi' ? (
        <>
          <SectionLabel>KPI tile</SectionLabel>
          <div style={{ fontSize: 10, color: DECK_THEME.slate, marginBottom: 6 }}>Linked to <code>{(obj as { metric: string }).metric}</code> (live)</div>
          <Field label="Style">
            <select value={(obj as { variant: string }).variant} onChange={(e) => onPatch({ variant: e.target.value })} style={inp}>
              <option value="pale">Pale</option><option value="navy">Navy</option><option value="green">Green</option><option value="plain">Plain</option>
            </select>
          </Field>
          <Field label="Sign colour"><input type="checkbox" checked={!!(obj as { signColor?: boolean }).signColor} onChange={(e) => onPatch({ signColor: e.target.checked })} /></Field>
          <Field label="Label"><input placeholder="(auto)" value={(obj as { labelOverride?: string | null }).labelOverride ?? ''} onChange={(e) => onPatch({ labelOverride: e.target.value || null })} style={inp} /></Field>
        </>
      ) : null}

      {obj.type === 'chart' ? (
        <>
          <SectionLabel>Chart</SectionLabel>
          <div style={{ fontSize: 10, color: DECK_THEME.slate, marginBottom: 6 }}>Linked to <code>{(obj as { chart: string }).chart}</code> (live)</div>
          <Field label="Title"><input placeholder="(none)" value={(obj as { title?: string | null }).title ?? ''} onChange={(e) => onPatch({ title: e.target.value || null })} style={inp} /></Field>
          <Field label="Legend"><input type="checkbox" checked={(obj as { showLegend?: boolean }).showLegend !== false} onChange={(e) => onPatch({ showLegend: e.target.checked })} /></Field>
        </>
      ) : null}

      {obj.type === 'table' ? (
        <>
          <SectionLabel>Table</SectionLabel>
          <div style={{ fontSize: 10, color: DECK_THEME.slate, marginBottom: 6 }}>Linked to <code>{(obj as { table: string }).table}</code> (live)</div>
          <Field label="Title"><input placeholder="(none)" value={(obj as { title?: string | null }).title ?? ''} onChange={(e) => onPatch({ title: e.target.value || null })} style={inp} /></Field>
          <Field label="Striped"><input type="checkbox" checked={!!(obj as { striped?: boolean }).striped} onChange={(e) => onPatch({ striped: e.target.checked })} /></Field>
          <Field label="Unit note"><input type="checkbox" checked={!!(obj as { showUnitNote?: boolean }).showUnitNote} onChange={(e) => onPatch({ showUnitNote: e.target.checked })} /></Field>
          {isPaginatedTable((obj as TableObject).table) ? (
            <>
              <Field label="Year page">
                <input
                  type="number" min={1} step={1}
                  value={((obj as TableObject).page ?? 0) + 1}
                  onChange={(e) => onPatch({ page: Math.max(0, (parseInt(e.target.value, 10) || 1) - 1) })}
                  style={inp}
                />
              </Field>
              <div style={{ fontSize: 10, color: DECK_THEME.slate, marginBottom: 6, lineHeight: 1.5 }}>
                This schedule spans every model year across several slides. Page {((obj as TableObject).page ?? 0) + 1} shows its
                own window of years; a page past the end of the model shows as unlinked rather than blank.
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {obj.type === 'toc' ? (
        <>
          <SectionLabel>Contents</SectionLabel>
          <div style={{ fontSize: 10, color: DECK_THEME.slate, marginBottom: 6, lineHeight: 1.5 }}>Lists the deck's slides live, with clickable page links. Reorder slides and this updates automatically.</div>
          <Field label="Heading"><input placeholder="(none)" value={(obj as { heading?: string }).heading ?? ''} onChange={(e) => onPatch({ heading: e.target.value })} style={inp} /></Field>
          <Field label="Numbers"><input type="checkbox" checked={(obj as { showNumbers?: boolean }).showNumbers !== false} onChange={(e) => onPatch({ showNumbers: e.target.checked })} /></Field>
          <Field label="Page numbers"><input type="checkbox" checked={(obj as { showPageNumbers?: boolean }).showPageNumbers !== false} onChange={(e) => onPatch({ showPageNumbers: e.target.checked })} /></Field>
          <Field label="Include">
            <select value={(obj as { scope?: string }).scope ?? 'sections'} onChange={(e) => onPatch({ scope: e.target.value })} style={inp}>
              <option value="sections">Content slides</option>
              <option value="all">All slides</option>
            </select>
          </Field>
        </>
      ) : null}

      {obj.type !== 'toc' ? (
        <LinkEditor link={obj.link} slides={slides} currentSlideId={currentSlideId} onChange={(l) => onPatch({ link: l })} />
      ) : null}

      <div style={{ marginTop: 14, fontSize: 10, color: DECK_THEME.slateLight, lineHeight: 1.5 }}>Data objects stay linked to the model: editing style never changes the number.</div>
    </>
  );
}
