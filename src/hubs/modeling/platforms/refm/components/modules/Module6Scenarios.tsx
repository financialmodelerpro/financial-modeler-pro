'use client';

/**
 * Module6Scenarios.tsx (Module 6 Scenario Analysis surface, 2026-06-14)
 *
 * A dedicated page over the EXISTING case engine (do not rebuild it). Three
 * sections, all reading the global module1 store directly:
 *   1. Cases: list / add / rename / delete / set active (the base is shown but
 *      not re-assignable here, re-basing is a separate unit).
 *   2. Override editor for the active scenario: the current overrides
 *      (base value -> case value, per-field reset + reset all) PLUS an explicit
 *      "add override" picker. Both the picker and ordinary input auto-capture
 *      write to the SAME live overrides map (the diff vs base), so they stay
 *      consistent.
 *   3. Comparison matrix: the shared buildCaseComparisonReport / CASE_KPIS,
 *      every case side by side with the delta vs the base.
 *
 * The field picker only offers fields from enumerateOverridableFields, which
 * mirrors the diffSnapshots grammar, so it can never offer a path that fails to
 * round-trip.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../lib/state/module1-store';
import { buildOverrides, getByPath, baseCaseId, enumerateOverridableFields } from '../../lib/cases/applyOverrides';
import {
  curatedDefaultFields, describeAssumption, assumptionFor, buildGridContext,
  formatAssumptionValue, parseAssumptionInput, assumptionUnitSuffix,
  ASSUMPTION_CATEGORY_ORDER, ASSUMPTION_CATEGORY_LABELS,
  type AssumptionCategory, type AssumptionDescriptor, type AssumptionFormat, type GridContext,
} from '../../lib/cases/assumptionGrid';
import { buildCaseComparisonReport, CASE_KPIS, type CaseKpiKind } from '../../lib/reports/caseComparisonReport';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { fmtPct, fmtX } from './Module5Shared';
import { FAST_INPUT } from './_shared/inputStyles';

type KpiKind = CaseKpiKind;


// ── Assumptions-grid cell ──────────────────────────────────────────────────
// One editable value per (case, assumption). Commit-on-blur / Enter so a single
// keystroke does not trigger a full model recompute. A scenario cell whose value
// equals the current base value clears the override instead of storing one (so
// the grid never carries a no-op override). Re-seeds via its React key when the
// upstream value changes.
function cellInputStyle(isOverride: boolean, isBaseCol: boolean): React.CSSProperties {
  const emphasised = isOverride && !isBaseCol;
  return {
    ...FAST_INPUT,
    width: 116,
    fontWeight: emphasised ? 700 : 400,
    ...(emphasised ? { borderColor: 'var(--color-navy)', color: 'var(--color-navy)' } : {}),
  };
}

interface GridCellProps {
  value: unknown;
  format: AssumptionFormat;
  isOverride: boolean;
  isBaseCol: boolean;
  baseValue: unknown;
  onCommit: (v: unknown) => void;
  onReset: () => void;
  testid?: string;
}

const resetBtn = (onReset: () => void): React.JSX.Element => (
  <button type="button" onClick={onReset} title="Clear override (track the Management value)"
    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 12, lineHeight: 1 }}>✕</button>
);

function GridCell({ value, format, isOverride, isBaseCol, baseValue, onCommit, onReset, testid }: GridCellProps): React.JSX.Element {
  // Draft is seeded in the DISPLAY unit (percent ×100 at 2dp, accounting grouped)
  // and re-seeds via the React key when the stored value changes.
  const initial = formatAssumptionValue(value, format);
  const [draft, setDraft] = useState(initial);

  if (format === 'boolean') {
    const cur = value === true || value === 'true';
    return (
      <select value={String(cur)} data-testid={testid} style={cellInputStyle(isOverride, isBaseCol)}
        onChange={(e) => { const b = e.target.value === 'true'; if (!isBaseCol && b === Boolean(baseValue)) onReset(); else onCommit(b); }}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (format === 'text') {
    const commitText = (): void => {
      if (draft === initial) return;
      if (!isBaseCol && draft === String(baseValue ?? '')) { onReset(); return; }
      onCommit(draft);
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitText(); (e.currentTarget as HTMLInputElement).blur(); } }}
          type="text" data-testid={testid} style={cellInputStyle(isOverride, isBaseCol)} />
        {isOverride && !isBaseCol && resetBtn(onReset)}
      </div>
    );
  }

  // Numeric: percent-fraction / percent-whole / accounting / number. Parse the
  // typed display value back to the stored scale on commit; equal-to-base clears.
  const suffix = assumptionUnitSuffix(format);
  const commitNum = (): void => {
    const parsed = parseAssumptionInput(draft, format);
    if (parsed === null || parsed === Number(value)) return;
    if (!isBaseCol && Number.isFinite(Number(baseValue)) && parsed === Number(baseValue)) { onReset(); return; }
    onCommit(parsed);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitNum}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') { commitNum(); (e.currentTarget as HTMLInputElement).blur(); } }}
        inputMode="decimal" type="text" data-testid={testid}
        style={{ ...cellInputStyle(isOverride, isBaseCol), width: suffix ? 88 : 116, textAlign: 'right' }} />
      {suffix && <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{suffix}</span>}
      {isOverride && !isBaseCol && resetBtn(onReset)}
    </div>
  );
}

export default function Module6Scenarios(): React.JSX.Element {
  const s = useModule1Store(
    useShallow((st) => ({
      cases: st.cases, activeCaseId: st.activeCaseId, baseSnapshot: st.baseSnapshot,
      project: st.project, phases: st.phases, parcels: st.parcels,
      landAllocationMode: st.landAllocationMode, assets: st.assets, subUnits: st.subUnits,
      costLines: st.costLines, costOverrides: st.costOverrides,
      financingTranches: st.financingTranches, equityContributions: st.equityContributions,
      migrationsApplied: st.migrationsApplied,
      setActiveCase: st.setActiveCase, addCase: st.addCase, renameCase: st.renameCase,
      removeCase: st.removeCase, clearCaseOverrides: st.clearCaseOverrides,
      resetOverridePath: st.resetOverridePath, setOverridePath: st.setOverridePath,
      setCaseFieldValue: st.setCaseFieldValue, resetCaseFieldValue: st.resetCaseFieldValue,
      setProject: st.setProject,
    })),
  );

  const scale: DisplayScale = (s.project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (s.project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(s.project.currency ?? 'SAR', scale);

  const baseId = baseCaseId(s.cases);
  const active = s.cases.find((c) => c.id === s.activeCaseId) ?? s.cases.find((c) => c.id === baseId);
  const isScenario = !!active && active.role !== 'base';

  // ── "Use scenarios?" toggle (project-level, persists with the project). ──
  // No: hide the grid + comparison AND force the active case back to Management
  // so a hidden scenario never drives the financials (cases are preserved).
  // Yes: restore the previously-active case + show everything. The case engine,
  // override map and topbar CaseSwitcher are untouched.
  const useScenarios = s.project.useScenarios ?? true;
  const setUseScenarios = (next: boolean): void => {
    if (next === useScenarios) return;
    if (!next) {
      // Turn OFF: remember the active scenario, revert to Management, recompute,
      // then stamp the flag onto the (now base) project so it persists.
      const prior = s.activeCaseId !== baseId ? s.activeCaseId : undefined;
      if (s.activeCaseId !== baseId) s.setActiveCase(baseId);
      s.setProject({ useScenarios: false, scenarioPriorCaseId: prior });
    } else {
      // Turn ON: stamp the flag, then restore the previously-active case if it
      // still exists (overrides are intact, never cleared).
      const prior = s.project.scenarioPriorCaseId;
      s.setProject({ useScenarios: true, scenarioPriorCaseId: undefined });
      if (prior && prior !== s.activeCaseId && s.cases.some((c) => c.id === prior)) s.setActiveCase(prior);
    }
  };

  const liveModel = {
    project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
    assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions, migrationsApplied: s.migrationsApplied,
  } as HydrateSnapshot;

  // Live overrides for the active scenario (the diff vs base, including the
  // explicit picker writes which land in this same map).
  const overrides = useMemo(
    () => (isScenario ? buildOverrides(s.baseSnapshot, liveModel) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isScenario, s.baseSnapshot, s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions],
  );
  const overridePaths = Object.keys(overrides);

  // ── Field catalog: only fields that round-trip the diff grammar. ──
  const fields = useMemo(() => enumerateOverridableFields(s.baseSnapshot), [s.baseSnapshot]);
  const fieldByPath = useMemo(() => new Map(fields.map((f) => [f.path, f])), [fields]);
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [showAll, setShowAll] = useState(false);
  // User-added grid rows (beyond the curated defaults + existing overrides).
  const [extraPaths, setExtraPaths] = useState<string[]>([]);

  // Base value source for the grid + id->name attribution context (asset / phase
  // / facility), so rows are never ambiguous duplicates.
  const activeIsBase = s.activeCaseId === baseId;
  const currentBaseModel: HydrateSnapshot = activeIsBase ? liveModel : s.baseSnapshot;
  const gridCtx: GridContext = useMemo(() => buildGridContext(currentBaseModel), [currentBaseModel]);

  // Add-row picker: filtered by search, grouped by category, plain labels.
  const pickerGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = new Map<AssumptionCategory, { path: string; text: string }[]>();
    for (const f of fields) {
      const d = describeAssumption(f, gridCtx);
      const text = `${d.label}${d.context ? ` (${d.context})` : ''}`;
      if (q && !`${text} ${f.path}`.toLowerCase().includes(q)) continue;
      const arr = m.get(d.category) ?? [];
      arr.push({ path: f.path, text });
      m.set(d.category, arr);
    }
    return ASSUMPTION_CATEGORY_ORDER.filter((c) => m.has(c)).map((c) => ({ category: c, label: ASSUMPTION_CATEGORY_LABELS[c], opts: m.get(c)! }));
  }, [fields, search, gridCtx]);

  // Every field a case currently overrides (so existing overrides always show).
  const allOverridePaths = useMemo(() => {
    const set = new Set<string>();
    for (const c of s.cases) {
      if (c.role === 'base') continue;
      const ov = c.id === s.activeCaseId ? overrides : (c.overrides ?? {});
      Object.keys(ov).forEach((p) => set.add(p));
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cases, s.activeCaseId, overrides]);

  // Row order: curated key drivers, then any existing override, then (when
  // "show all" is on) the full catalog, then user-added rows.
  const rowPaths = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (p: string): void => { if (!seen.has(p)) { seen.add(p); out.push(p); } };
    curatedDefaultFields(currentBaseModel).forEach((f) => add(f.path));
    allOverridePaths.forEach(add);
    if (showAll) fields.forEach((f) => add(f.path));
    extraPaths.forEach(add);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBaseModel, allOverridePaths, showAll, fields, extraPaths]);

  // Group rows by category, in Inputs-tab order, dropping empty groups.
  interface GridRow { path: string; descriptor: AssumptionDescriptor; }
  const groups = useMemo(() => {
    const byCat = new Map<AssumptionCategory, GridRow[]>();
    for (const path of rowPaths) {
      const f = fieldByPath.get(path);
      const descriptor = assumptionFor(path, f, getByPath(currentBaseModel, path), gridCtx);
      const arr = byCat.get(descriptor.category) ?? [];
      arr.push({ path, descriptor });
      byCat.set(descriptor.category, arr);
    }
    return ASSUMPTION_CATEGORY_ORDER
      .filter((c) => (byCat.get(c)?.length ?? 0) > 0)
      .map((c) => ({ category: c, label: ASSUMPTION_CATEGORY_LABELS[c], rows: byCat.get(c)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowPaths, fieldByPath, currentBaseModel, gridCtx]);

  // Per-cell value + whether this case overrides the field at this path.
  const cellFor = (c: typeof s.cases[number], path: string): { value: unknown; isOverride: boolean } => {
    if (c.role === 'base') return { value: getByPath(currentBaseModel, path), isOverride: false };
    if (c.id === s.activeCaseId) {
      return { value: getByPath(liveModel, path), isOverride: Object.prototype.hasOwnProperty.call(overrides, path) };
    }
    const ov = c.overrides ?? {};
    const has = Object.prototype.hasOwnProperty.call(ov, path);
    return { value: has ? ov[path] : getByPath(currentBaseModel, path), isOverride: has };
  };

  const addRow = (): void => {
    if (!selectedPath) return;
    setExtraPaths((prev) => (rowPaths.includes(selectedPath) || prev.includes(selectedPath) ? prev : [...prev, selectedPath]));
    setSelectedPath('');
    setSearch('');
  };
  const removeRow = (path: string): void => {
    setExtraPaths((prev) => prev.filter((p) => p !== path));
    // Also clear any override every scenario holds for this path, so a removed
    // row does not silently keep affecting a case.
    for (const c of s.cases) {
      if (c.role === 'base') continue;
      const ov = c.id === s.activeCaseId ? overrides : (c.overrides ?? {});
      if (Object.prototype.hasOwnProperty.call(ov, path)) s.resetCaseFieldValue(c.id, path);
    }
  };

  // ── Comparison matrix (shared builder). ──
  const computed = useMemo(() => {
    const activeIsBase = s.activeCaseId === baseId;
    const baseModel: HydrateSnapshot = activeIsBase ? liveModel : s.baseSnapshot;
    const activeOverrideCount = activeIsBase ? 0 : overridePaths.length;
    return buildCaseComparisonReport({ baseModel, cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: liveModel, activeOverrideCount }).columns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cases, s.activeCaseId, s.baseSnapshot, s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, baseId]);
  const baseCol = computed.find((c) => c.id === baseId) ?? computed[0];

  const fmtVal = (v: number | null, kind: KpiKind): string => {
    if (v == null || !Number.isFinite(v)) return 'n/a';
    if (kind === 'pct') return fmtPct(v);
    if (kind === 'mult') return fmtX(v);
    return fmt(v);
  };
  const fmtDelta = (v: number | null, base: number | null, kind: KpiKind): string => {
    if (v == null || base == null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const d = v - base;
    if (Math.abs(d) < 1e-9) return '0';
    const sign = d > 0 ? '+' : '';
    if (kind === 'pct') return `${sign}${(d * 100).toFixed(1)} pp`;
    if (kind === 'mult') return `${sign}${d.toFixed(2)}x`;
    return `${sign}${fmt(d)}`;
  };
  const deltaTone = (v: number | null, base: number | null): string => {
    if (v == null || base == null) return 'var(--color-meta)';
    const d = v - base;
    if (Math.abs(d) < 1e-9) return 'var(--color-meta)';
    return d > 0 ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)';
  };

  const card: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 8, padding: 'var(--sp-2)', marginBottom: 'var(--sp-3)', background: 'var(--color-surface, #fff)' };
  const sectionTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, color: 'var(--color-heading)', marginBottom: 8 };
  const th: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 12 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 12, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  const segBtn = (on: boolean, label: string, onClick: () => void, testid: string): React.JSX.Element => (
    <button type="button" onClick={onClick} data-testid={testid}
      style={{ border: '1px solid var(--color-navy)', padding: '5px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
        background: on ? 'var(--color-navy)' : 'transparent', color: on ? 'var(--color-on-primary-navy)' : 'var(--color-navy)' }}>
      {label}
    </button>
  );

  return (
    <div data-testid="module6-scenarios" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      {/* ── "Use scenarios?" toggle ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)' }}>Use scenarios?</span>
        <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }} data-testid="m6-use-scenarios">
          {segBtn(useScenarios, 'Yes', () => setUseScenarios(true), 'm6-use-scenarios-yes')}
          {segBtn(!useScenarios, 'No', () => setUseScenarios(false), 'm6-use-scenarios-no')}
        </div>
      </div>

      {useScenarios ? (
        <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
          A scenario is the Management (base) case plus a few input overrides. The active case drives every module and the Returns tabs.
          Edit any input while a scenario is active to capture an override automatically, or add one explicitly below. The base model is never changed.
        </p>
      ) : (
        <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }} data-testid="m6-scenarios-off-note">
          Scenarios are off. The platform computes on the Management Case, and the assumptions grid and case comparison are hidden.
          Your cases and overrides are saved, not deleted. Set &quot;Use scenarios?&quot; to Yes to design and compare them again.
        </p>
      )}

      {/* ── 1. Cases ─────────────────────────────────────────────── */}
      <section style={card} data-testid="m6-cases">
        <div style={sectionTitle}>1. Cases</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {s.cases.map((c) => {
            const isActive = c.id === s.activeCaseId;
            const isBase = c.role === 'base';
            const count = isBase ? 0 : Object.keys(c.id === s.activeCaseId ? overrides : (c.overrides ?? {})).length;
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                border: isActive ? '1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)' : '1px solid var(--color-border)',
                background: isActive ? 'color-mix(in srgb, var(--color-primary) 7%, transparent)' : 'transparent',
              }}>
                <button type="button" onClick={() => s.setActiveCase(c.id)} data-testid={`m6-case-select-${c.id}`}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-heading)', fontWeight: isActive ? 700 : 500 }}
                  title={isActive ? 'Active case' : 'Switch to this case'}>
                  {isBase ? '★' : '◆'}
                </button>
                <input value={c.name} onChange={(e) => s.renameCase(c.id, e.target.value)} style={{ ...FAST_INPUT, width: 200, fontWeight: isActive ? 700 : 500 }} title="Rename case" />
                <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{isBase ? 'base' : `${count} override${count === 1 ? '' : 's'}`}</span>
                {isActive && <span style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 700 }}>ACTIVE</span>}
                <div style={{ flex: 1 }} />
                {!isActive && (
                  <button type="button" onClick={() => s.setActiveCase(c.id)} style={{ border: '1px solid var(--color-navy)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--color-navy)', fontSize: 11, padding: '3px 9px' }}>
                    Set active
                  </button>
                )}
                {!isBase && (
                  <button type="button" onClick={() => s.removeCase(c.id)} data-testid={`m6-case-remove-${c.id}`}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 14 }} title="Delete case">✕</button>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => s.addCase()} data-testid="m6-case-add"
          style={{ marginTop: 10, border: '1px solid var(--color-navy)', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--color-navy)' }}>
          + Add case
        </button>
      </section>

      {/* Sections 2 + 3 render only when scenarios are on. */}
      {useScenarios && (<>
      {/* ── 2. Assumptions grid ──────────────────────────────────── */}
      <section style={card} data-testid="m6-overrides">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
          <div style={sectionTitle}>2. Assumptions by case</div>
          <button type="button" onClick={() => setShowAll((v) => !v)} data-testid="m6-show-all"
            style={{ border: '1px solid var(--color-navy)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11, background: showAll ? 'var(--color-navy)' : 'transparent', color: showAll ? 'var(--color-on-primary-navy)' : 'var(--color-navy)' }}>
            {showAll ? 'Showing all assumptions' : 'Show all assumptions'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 10 }}>
          Each row is an assumption, each column a case. Edit any cell to set that case&apos;s value. A scenario cell that differs from the Management Case shows in navy with a ✕ to clear it back to base. Editing the Management column changes the base every module reads. Key drivers show by default; toggle &quot;Show all assumptions&quot; or add a specific one below.
        </div>

        {/* Add-assumption picker (adds a row; values are then entered per case). */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: 'var(--color-meta)' }}>Filter fields</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. price, occupancy, discount" style={{ ...FAST_INPUT, width: 200 }} data-testid="m6-field-search" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: 'var(--color-meta)' }}>Assumption</label>
            <select value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)} style={{ ...FAST_INPUT, width: 320 }} data-testid="m6-field-select">
              <option value="">Select a field to add as a row…</option>
              {pickerGroups.map((g) => (
                <optgroup key={g.category} label={g.label}>
                  {g.opts.map((o) => <option key={o.path} value={o.path}>{o.text}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <button type="button" onClick={addRow} disabled={!selectedPath} data-testid="m6-add-override"
            style={{ border: '1px solid var(--color-navy)', borderRadius: 6, padding: '6px 14px', cursor: selectedPath ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 12, background: selectedPath ? 'var(--color-navy)' : 'transparent', color: selectedPath ? 'var(--color-on-primary-navy)' : 'var(--color-muted)' }}>
            + Add assumption row
          </button>
        </div>

        {groups.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-meta)', fontStyle: 'italic' }}>
            No assumptions yet. Add one above to start comparing values across cases.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 480 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ ...thL, position: 'sticky', left: 0, background: 'var(--color-navy)', minWidth: 240 }}>Assumption</th>
                  {s.cases.map((c) => {
                    const cnt = c.role === 'base' ? 0 : (c.id === s.activeCaseId ? overridePaths.length : Object.keys(c.overrides ?? {}).length);
                    return (
                      <th key={c.id} style={{ ...thL, minWidth: 160 }}>
                        <button type="button" onClick={() => s.setActiveCase(c.id)} data-testid={`m6-grid-col-${c.id}`}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontWeight: c.id === s.activeCaseId ? 800 : 600 }}
                          title={c.id === s.activeCaseId ? 'Active case' : 'Switch to this case'}>
                          {c.role === 'base' ? '★ ' : '◆ '}{c.name}
                        </button>
                        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>{c.role === 'base' ? 'base (editable)' : `${cnt} override${cnt === 1 ? '' : 's'}`}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g.category}>
                    <tr data-testid={`m6-group-${g.category}`}>
                      <td colSpan={1 + s.cases.length}
                        style={{ background: 'color-mix(in srgb, var(--color-navy) 12%, transparent)', color: 'var(--color-heading)', fontWeight: 800, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', padding: '6px 12px', borderBottom: '1px solid var(--color-border)', position: 'sticky', left: 0 }}>
                        {g.label}
                      </td>
                    </tr>
                    {g.rows.map((row) => {
                      const p = row.path;
                      const baseValue = getByPath(currentBaseModel, p);
                      return (
                        <tr key={p} data-testid={`m6-override-${p}`}>
                          <td style={{ ...tdL, position: 'sticky', left: 0, background: 'var(--color-surface, #fff)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button type="button" onClick={() => removeRow(p)} title="Remove this row" data-testid={`m6-row-remove-${p}`}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 13, lineHeight: 1 }}>✕</button>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: 'var(--color-heading)', fontSize: 12 }} title={p}>{row.descriptor.label}</div>
                                {row.descriptor.context && <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>{row.descriptor.context}</div>}
                              </div>
                            </div>
                          </td>
                          {s.cases.map((c) => {
                            const { value, isOverride } = cellFor(c, p);
                            return (
                              <td key={c.id} style={{ ...td, textAlign: 'left', background: c.id === s.activeCaseId ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : undefined }}>
                                <GridCell
                                  key={`${c.id}:${p}:${String(value)}`}
                                  value={value} format={row.descriptor.format} isOverride={isOverride} isBaseCol={c.role === 'base'} baseValue={baseValue}
                                  onCommit={(v) => s.setCaseFieldValue(c.id, p, v)}
                                  onReset={() => s.resetCaseFieldValue(c.id, p)}
                                  testid={`m6-cell-${c.id}-${p}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. Comparison matrix ─────────────────────────────────── */}
      <section style={card} data-testid="m6-comparison">
        <div style={sectionTitle}>3. Comparison</div>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 8 }}>
          Every case computed through the full model. Money figures in {currency}. The small figure under each scenario is the delta vs the Management Case.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={thL}>Metric</th>
                {computed.map((c) => (
                  <th key={c.id} style={th}>
                    <button type="button" onClick={() => s.setActiveCase(c.id)} data-testid={`m6-case-col-${c.id}`}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontWeight: c.id === s.activeCaseId ? 800 : 600, textAlign: 'right' }}
                      title={c.id === s.activeCaseId ? 'Active case' : 'Switch to this case'}>
                      {c.role === 'base' ? '★ ' : '◆ '}{c.name}
                    </button>
                    <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>{c.role === 'base' ? 'base' : `${c.overrideCount} override${c.overrideCount === 1 ? '' : 's'}`}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CASE_KPIS.map((k) => (
                <tr key={k.label}>
                  <td style={tdL}>{k.label}{k.sub && <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>{k.sub}</div>}</td>
                  {computed.map((c) => {
                    const v = c.values[k.label];
                    const isBase = c.id === baseId;
                    return (
                      <td key={c.id} style={{ ...td, background: c.id === s.activeCaseId ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : undefined }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{fmtVal(v, k.kind)}</div>
                        {!isBase && <div style={{ fontSize: 10, color: deltaTone(v, baseCol?.values[k.label] ?? null) }}>{fmtDelta(v, baseCol?.values[k.label] ?? null, k.kind)}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </>)}
    </div>
  );
}
