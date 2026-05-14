'use client';

/**
 * Dashboard.tsx (Pass 45 redesign, 2026-05-14)
 *
 * Project landing page rendered when activeModule === 'dashboard'. The
 * old portfolio-overview shell shipped under M2.0b is replaced with a
 * project-scoped surface optimised for the "I just opened a project,
 * what is this thing?" moment.
 *
 * Sections (top to bottom):
 *   1. Hero strip:        project name + status pill + meta line + Save / Edit buttons
 *   2. Health summary:    6 KPI tiles using the Module1Financing tile() pattern
 *   3. Module quick-jump: 4 cards (Setup / Assets / Costs / Financing) with completion hints
 *   4. Phase summary:     status pill + windows + assets + capex + share bar; existing-ops tooltip
 *   5. Reconciliation:    horizontal chip strip (asset balances, funding ratio, equity, project-end)
 *   6. Version history:   last 5 versions, relative timestamps, click to load
 *   7. Empty state:       when no project is selected, surfaces portfolio + create CTA
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PermissionMap } from '@/src/core/types/settings.types';
import { currencyHeaderLine, formatNumber, formatAccounting } from '@/src/core/formatters';
import {
  computeLandAggregate,
  computePhaseCost,
  computeProjectTimeline,
} from '@/src/core/calculations';
import { computeFinancingResult } from '@/src/core/calculations/financing';
import * as pclient from '../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../lib/persistence/types';
import type { StorageShape } from './RealEstatePlatform';
import { useModule1Store } from '../lib/state/module1-store';
import {
  DEFAULT_PROJECT_FINANCING_CONFIG,
  type ProjectFinancingConfig,
} from '../lib/state/module1-types';

function ensureConfig(cfg: ProjectFinancingConfig | undefined): ProjectFinancingConfig {
  return cfg ?? { ...DEFAULT_PROJECT_FINANCING_CONFIG, parcelFunding: [] };
}

interface DashboardProps {
  storage: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onSelectModule: (m: string) => void;
  onSelectTab: (t: string) => void;
  onSaveVersion: () => void;
  onLoadVersion: (projectId: string, versionId: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

// ── Relative-time helper ───────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? '' : 's'} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

// ── Status pill colour map ─────────────────────────────────────────────────
type StatusPillKind = 'draft' | 'active' | 'archived' | 'planning' | 'construction' | 'operational';
const STATUS_PILL: Record<StatusPillKind, { bg: string; fg: string; border: string; label: string }> = {
  draft:        { bg: 'color-mix(in srgb, var(--color-meta) 12%, transparent)',     fg: 'var(--color-meta)',     border: 'color-mix(in srgb, var(--color-meta) 25%, transparent)',     label: 'Draft' },
  active:       { bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)',  fg: 'var(--color-success)',  border: 'color-mix(in srgb, var(--color-success) 30%, transparent)',  label: 'Active' },
  archived:     { bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)',  fg: 'var(--color-warning)',  border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',  label: 'Archived' },
  planning:     { bg: 'color-mix(in srgb, var(--color-meta) 12%, transparent)',     fg: 'var(--color-meta)',     border: 'color-mix(in srgb, var(--color-meta) 25%, transparent)',     label: 'Planning' },
  construction: { bg: 'color-mix(in srgb, var(--color-navy) 12%, transparent)',     fg: 'var(--color-navy)',     border: 'color-mix(in srgb, var(--color-navy) 25%, transparent)',     label: 'Construction' },
  operational:  { bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)',  fg: 'var(--color-success)',  border: 'color-mix(in srgb, var(--color-success) 30%, transparent)',  label: 'Operational' },
};

function StatusPill({ kind }: { kind: StatusPillKind }): React.JSX.Element {
  const meta = STATUS_PILL[kind];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '2px 8px',
        borderRadius: 20,
        background: meta.bg,
        color: meta.fg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  );
}

// ── Reconciliation chip ────────────────────────────────────────────────────
type ChipKind = 'ok' | 'warn' | 'err';
const CHIP_COLOR: Record<ChipKind, { bg: string; fg: string; border: string; icon: string }> = {
  ok:   { bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)', fg: 'var(--color-success)', border: 'color-mix(in srgb, var(--color-success) 30%, transparent)', icon: '✓' },
  warn: { bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', fg: 'var(--color-warning)', border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)', icon: '!' },
  err:  { bg: 'color-mix(in srgb, var(--color-danger)  12%, transparent)', fg: 'var(--color-danger)',  border: 'color-mix(in srgb, var(--color-danger)  30%, transparent)', icon: '✗' },
};
function Chip({ kind, label, title }: { kind: ChipKind; label: string; title?: string }): React.JSX.Element {
  const c = CHIP_COLOR[kind];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        cursor: title ? 'help' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800 }}>{c.icon}</span>
      {label}
    </span>
  );
}

export default function Dashboard({
  storage,
  activeProjectId,
  activeVersionId,
  onCreateProject,
  onSelectProject,
  onSelectModule,
  onSelectTab,
  onSaveVersion,
  onLoadVersion,
  can,
}: DashboardProps): React.JSX.Element {
  const {
    project,
    phases,
    parcels,
    assets,
    subUnits,
    costLines,
    costOverrides,
    financingTranches,
    equityContributions,
    landAllocationMode,
  } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
      landAllocationMode: s.landAllocationMode,
    })),
  );

  const projectsList = Object.entries(storage.projects);
  const proj = activeProjectId ? storage.projects[activeProjectId] : null;
  const activeVersionData =
    proj && activeVersionId ? proj.versions[activeVersionId] ?? null : null;

  const scale = project.displayScale ?? 'full';
  const decimals = project.displayDecimals ?? 2;
  const fmt = (n: number): string => formatAccounting(n, scale, decimals);
  const currency = project.currency || 'SAR';

  // ── Versions, fetched lazily via the API ───────────────────────────────
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  useEffect(() => {
    if (!activeProjectId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    void (async () => {
      const res = await pclient.listVersions(activeProjectId);
      if (cancelled) return;
      setVersions(res.data?.versions ?? []);
      setVersionsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // refresh when the active version id flips (after a new save)
  }, [activeProjectId, activeVersionId]);

  // Pass 47b (2026-05-14): hoisted above the no-project early return to
  // keep hook call order consistent across renders (Rules of Hooks).
  // The values are only consumed in the project-loaded branch below.
  const financingConfig = useMemo(() => ensureConfig(project.financing), [project.financing]);
  const result = useMemo(
    () =>
      computeFinancingResult({
        project,
        phases,
        parcels,
        assets,
        subUnits,
        costLines,
        costOverrides,
        landAllocationMode,
        financingConfig,
        tranches: financingTranches,
        equityContributions,
      }),
    [
      project,
      phases,
      parcels,
      assets,
      subUnits,
      costLines,
      costOverrides,
      landAllocationMode,
      financingConfig,
      financingTranches,
      equityContributions,
    ],
  );

  // ── Empty state when no project is selected ────────────────────────────
  if (!proj || !activeProjectId) {
    return (
      <div className="module-view" data-testid="dashboard">
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <h1
            style={{
              fontSize: 'var(--font-h1)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Welcome to REFM
          </h1>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: 6 }}>
            Open a project to see its dashboard, or create a new one to get started.
          </p>
        </div>
        <div
          className="module-card"
          style={{
            padding: 'var(--sp-3)',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
          }}
          data-testid="dashboard-empty"
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 'var(--sp-1)' }}>🏗️</div>
          <div style={{ fontWeight: 700, color: 'var(--color-heading)', marginBottom: 6 }}>
            No project selected
          </div>
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
            {projectsList.length === 0
              ? 'You have no saved projects yet.'
              : `Pick one of your ${projectsList.length} project${projectsList.length === 1 ? '' : 's'}, or start a fresh model.`}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={onCreateProject}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
              data-testid="dashboard-create"
            >
              + New Project
            </button>
            {projectsList.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectModule('projects')}
                className="btn-secondary"
                style={{ padding: 'var(--sp-1) var(--sp-2)' }}
              >
                Browse Projects
              </button>
            )}
          </div>
        </div>

        {projectsList.length > 0 && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <h3
              style={{
                fontSize: 11,
                fontWeight: 'var(--fw-semibold)',
                color: 'var(--color-heading)',
                marginBottom: 'var(--sp-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Recent Projects
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--sp-2)',
              }}
            >
              {projectsList.slice(0, 6).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectProject(id)}
                  data-testid={`dashboard-project-${id}`}
                  className="module-card"
                  style={{
                    textAlign: 'left',
                    padding: 'var(--sp-2)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    background: 'var(--color-surface)',
                  }}
                >
                  <strong style={{ color: 'var(--color-heading)' }}>{p.name}</strong>
                  <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 2 }}>
                    {p.location || 'No location'} · {p.status}
                  </div>
                  <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-muted)', marginTop: 6 }}>
                    Updated {new Date(p.lastModified).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Calc rollups for the project context ───────────────────────────────
  const land = computeLandAggregate(parcels);
  const totalLandValue = land.totalValue;
  const totalProjectGFA = assets.reduce((s, a) => s + (a.gfaSqm || 0), 0);
  const totalProjectBUA = assets.reduce((s, a) => s + (a.buaSqm || 0), 0);
  const totalCapex = phases.reduce(
    (s, p) =>
      s + computePhaseCost(p, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode).total,
    0,
  );

  // Financing engine + funding/debt-equity rollups (Pass 44 totals).
  // The `result` + `financingConfig` useMemo calls are hoisted above
  // the no-project early return (see Pass 47b).
  const totalDebtSized = result.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
  const totalEquitySized = result.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
  const totalFunding = totalDebtSized + totalEquitySized;

  // Existing-operations exposure.
  // Pass 51 (2026-05-14): the headline figure is Pre-Capex - the
  // historical capex sunk into existing assets. Funding identity says
  // Pre-Capex = Existing Debt + Existing Equity, so summing all three
  // double-counts. Show Pre-Capex as the tile value; the Debt + Equity
  // breakdown belongs in the sublabel.
  const existingTotal = result.existing.preCapexTotal;
  const existingDebtTotal = result.existing.debtOutstandingTotal;
  const existingEquityTotal = result.existing.equityTotal;

  // Project duration (years from project.startDate to operations end)
  const timeline = computeProjectTimeline(project, phases);
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const projectEndYear = new Date(timeline.endDate).getUTCFullYear();
  const projectDurationYears = Math.max(0, projectEndYear - projectStartYear);

  // Counts for module quick-jump completion hints
  const phaseCount = phases.length;
  const assetCount = assets.length;
  const parcelCount = parcels.length;
  const costLineCount = costLines.length;
  const facilityCount = financingTranches.length;
  const equityCount = equityContributions.length;

  // ── Project status pill ───────────────────────────────────────────────
  const projectStatusKind: StatusPillKind =
    project.status === 'active' ? 'active' : project.status === 'archived' ? 'archived' : 'draft';

  // ── Hero / KPI tile builder (mirrors Module1Financing.tsx pattern) ─────
  const tile = (
    label: string,
    value: string,
    sublabel: string,
    accent: string,
  ): React.JSX.Element => (
    <div
      key={label}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-1) var(--sp-2)',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-heading)' }}>{value}</div>
      <div
        style={{
          fontSize: 9,
          color: 'var(--color-text-muted)',
          marginTop: 2,
          fontStyle: 'italic',
        }}
      >
        {sublabel}
      </div>
    </div>
  );

  const hasExistingOps = existingTotal > 0;

  // ── Reconciliation chips ──────────────────────────────────────────────
  const chips: Array<{ kind: ChipKind; label: string; title: string }> = [];

  // Per-asset Pre-Capex == Debt + Equity for operational assets
  const opAssets = assets.filter((a) =>
    phases.some((p) => p.id === a.phaseId && p.status === 'operational'),
  );
  const unbalancedOpAssets = opAssets.filter((a) => {
    const pre = a.historicalPreCapex ?? 0;
    const d = a.historicalDebtAmount ?? 0;
    const e = a.historicalEquityAmount ?? 0;
    return Math.abs(pre - (d + e)) > 1;
  });
  if (opAssets.length > 0) {
    if (unbalancedOpAssets.length === 0) {
      chips.push({
        kind: 'ok',
        label: `Existing Assets: ${opAssets.length} balanced`,
        title: 'Pre-Capex equals Existing Debt + Existing Equity for every operational asset.',
      });
    } else {
      chips.push({
        kind: 'err',
        label: `Existing Assets: ${unbalancedOpAssets.length} of ${opAssets.length} unbalanced`,
        title: `Pre-Capex != Debt + Equity for: ${unbalancedOpAssets.map((a) => a.name).join(', ')}.`,
      });
    }
  }

  // Funding ratio
  const debtPct = financingConfig.fixedRatio?.debtPct ?? 0;
  const equityPct = financingConfig.fixedRatio?.equityPct ?? 0;
  const ratioOk = Math.abs(debtPct + equityPct - 100) < 0.01;
  const methodId = financingConfig.fundingMethod;
  if (methodId === 1) {
    chips.push({
      kind: ratioOk ? 'ok' : 'warn',
      label: `Funding ratio: ${debtPct}/${equityPct}`,
      title: ratioOk ? 'Method 1: Fixed ratio sums to 100.' : `Method 1 ratio sums to ${debtPct + equityPct}, should be 100.`,
    });
  } else if (methodId === 4) {
    const fa = financingConfig.fixedAmountConfig;
    const setOk = (fa?.debtAmount ?? 0) > 0 || (fa?.equityAmount ?? 0) > 0;
    chips.push({
      kind: setOk ? 'ok' : 'warn',
      label: `Method 4: ${setOk ? 'amounts set' : 'amounts missing'}`,
      title: setOk
        ? `Manual: ${fmt(fa?.debtAmount ?? 0)} debt + ${fmt(fa?.equityAmount ?? 0)} equity.`
        : 'Specify debt and equity amounts in Tab 4.',
    });
  } else {
    chips.push({
      kind: 'ok',
      label: `Funding method ${methodId}`,
      title: `Active funding method: ${methodId}.`,
    });
  }

  // Equity composition: cash + in-kind
  const totalEquityCash = result.equity.totalCash;
  const totalEquityInKind = result.equity.totalInKind;
  if (totalEquityCash + totalEquityInKind > 0) {
    chips.push({
      kind: 'ok',
      label: `Equity: ${fmt(totalEquityCash)} cash + ${fmt(totalEquityInKind)} in-kind`,
      title: `Cash equity: ${fmt(totalEquityCash)}. In-kind equity: ${fmt(totalEquityInKind)}.`,
    });
  } else if (equityCount === 0) {
    chips.push({
      kind: 'warn',
      label: 'Equity: no contributions defined',
      title: 'Add at least one equity contribution in Tab 4 Financing.',
    });
  }

  // Capex coverage
  if (totalCapex > 0 && totalFunding > 0) {
    const coverage = totalFunding / totalCapex;
    const coverageOk = Math.abs(coverage - 1) < 0.01;
    chips.push({
      kind: coverageOk ? 'ok' : 'warn',
      label: `Funding covers ${(coverage * 100).toFixed(0)}% of capex`,
      title: `${fmt(totalFunding)} sized vs ${fmt(totalCapex)} capex.`,
    });
  }

  // Project end
  if (phaseCount > 0) {
    chips.push({
      kind: 'ok',
      label: `Horizon: ${projectStartYear} to ${projectEndYear} (${projectDurationYears} yr)`,
      title: `Earliest construction start ${timeline.startDate}, latest operations end ${timeline.endDate}.`,
    });
  }

  // ── Module quick-jump deck (4 cards) ──────────────────────────────────
  const moduleCards: Array<{
    icon: string;
    name: string;
    desc: string;
    hint: string;
    tab: string;
  }> = [
    {
      icon: '📅',
      name: 'Setup',
      desc: 'Project meta, phases, timing windows',
      hint: phaseCount === 0 ? 'No phases yet' : `${phaseCount} phase${phaseCount === 1 ? '' : 's'} configured`,
      tab: 'project-phases',
    },
    {
      icon: '🏗️',
      name: 'Assets',
      desc: 'Land parcels, asset cards, sub-units',
      hint:
        assetCount === 0
          ? 'No assets yet'
          : `${assetCount} asset${assetCount === 1 ? '' : 's'}, ${parcelCount} parcel${parcelCount === 1 ? '' : 's'}`,
      tab: 'assets',
    },
    {
      icon: '💸',
      name: 'Costs',
      desc: 'Cost lines, overrides, IDC drivers',
      hint:
        costLineCount === 0
          ? 'No cost lines yet'
          : `${costLineCount} cost line${costLineCount === 1 ? '' : 's'} defined`,
      tab: 'costs',
    },
    {
      icon: '🏦',
      name: 'Financing',
      desc: 'Funding method, facilities, equity',
      hint:
        facilityCount === 0 && equityCount === 0
          ? 'Capital stack empty'
          : `${facilityCount} facilit${facilityCount === 1 ? 'y' : 'ies'}, ${equityCount} equity tranche${equityCount === 1 ? '' : 's'}`,
      tab: 'financing',
    },
  ];

  // ── Phase rows (with share-of-capex bar) ──────────────────────────────
  const phaseRows = phases.map((p) => {
    const capex = computePhaseCost(p, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode).total;
    const sharePct = totalCapex > 0 ? (capex / totalCapex) * 100 : 0;
    const phaseAssets = assets.filter((a) => a.phaseId === p.id);
    const phaseStatusKind: StatusPillKind = (p.status ?? 'planning') as StatusPillKind;

    // existing-ops totals for this phase (operational only)
    let preCapex = 0;
    let exDebt = 0;
    let exEquity = 0;
    if (p.status === 'operational') {
      for (const a of phaseAssets) {
        preCapex += Math.max(0, a.historicalPreCapex ?? 0);
        exDebt += Math.max(0, a.historicalDebtAmount ?? 0);
        exEquity += Math.max(0, a.historicalEquityAmount ?? 0);
      }
    }
    const cumDep = Math.max(0, p.historicalBaseline?.cumulativeDepreciationCharged ?? 0);
    const nbv = Math.max(0, p.historicalBaseline?.netBookValueFixedAssets ?? 0);
    const retEarn = Math.max(0, p.historicalBaseline?.existingRetainedEarnings ?? 0);

    // construction / operations windows in absolute years
    const phaseStartYear = p.startDate
      ? new Date(p.startDate).getUTCFullYear()
      : projectStartYear + Math.max(0, (p.constructionStart ?? 1) - 1);
    const constrEndYear = phaseStartYear + Math.max(0, p.constructionPeriods - 1);
    const opsStartYear = constrEndYear + 1 - Math.max(0, p.overlapPeriods);
    const opsEndYear = opsStartYear + Math.max(0, p.operationsPeriods - 1);

    const constructionLabel =
      p.constructionPeriods > 0 ? `${phaseStartYear} to ${constrEndYear} (${p.constructionPeriods} yr)` : 'n/a';
    const operationsLabel =
      p.operationsPeriods > 0 ? `${opsStartYear} to ${opsEndYear} (${p.operationsPeriods} yr)` : 'n/a';

    const tooltipLines =
      p.status === 'operational'
        ? [
            `Pre-Capex: ${fmt(preCapex)}`,
            `Existing Debt: ${fmt(exDebt)}`,
            `Existing Equity: ${fmt(exEquity)}`,
            `Cumulative Depreciation: ${fmt(cumDep)}`,
            `Net Book Value: ${fmt(nbv)}`,
            `Retained Earnings: ${fmt(retEarn)}`,
          ].join('\n')
        : '';

    return {
      id: p.id,
      name: p.name,
      statusKind: phaseStatusKind,
      construction: constructionLabel,
      operations: operationsLabel,
      assetCount: phaseAssets.length,
      capex,
      sharePct,
      tooltip: tooltipLines,
    };
  });

  return (
    <div className="module-view" data-testid="dashboard">
      {/* ── 1. Hero strip ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          paddingBottom: 'var(--sp-2)',
          borderBottom: '1px solid var(--color-border)',
        }}
        data-testid="dashboard-hero"
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: 'var(--font-h1)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-heading)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
              data-testid="dashboard-project-name"
            >
              {proj.name}
            </h1>
            <StatusPill kind={projectStatusKind} />
            {activeVersionData && (
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 20,
                  background: 'color-mix(in srgb, var(--color-navy) 10%, transparent)',
                  color: 'var(--color-navy)',
                  border: '1px solid color-mix(in srgb, var(--color-navy) 25%, transparent)',
                }}
                title="Currently loaded version"
              >
                {activeVersionData.name}
              </span>
            )}
          </div>
          <div
            style={{
              color: 'var(--color-meta)',
              fontSize: 'var(--font-body)',
              marginTop: 6,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>{proj.location || project.location || 'No location'}</span>
            <span style={{ color: 'var(--color-border)' }}>|</span>
            <span>{currency}</span>
            <span style={{ color: 'var(--color-border)' }}>|</span>
            <span>{project.modelType === 'monthly' ? 'Monthly' : 'Annual'} model</span>
            {phaseCount > 0 && (
              <>
                <span style={{ color: 'var(--color-border)' }}>|</span>
                <span>
                  {phaseCount} phase{phaseCount === 1 ? '' : 's'}, {assetCount} asset
                  {assetCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
          <div
            style={{
              fontSize: 'var(--font-small)',
              color: 'var(--color-meta)',
              fontStyle: 'italic',
              marginTop: 4,
            }}
            data-testid="dashboard-currency-header"
          >
            {currencyHeaderLine(currency, scale)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {can('canSave') && (
            <button
              type="button"
              className="btn-primary"
              onClick={onSaveVersion}
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
              data-testid="dashboard-save-version"
            >
              Save Version
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              onSelectModule('module1');
              onSelectTab('project-phases');
            }}
            style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            data-testid="dashboard-edit-model"
          >
            Edit Model
          </button>
        </div>
      </div>

      {/* ── 2. Health summary ─────────────────────────────────────── */}
      <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="dashboard-kpi-grid">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${hasExistingOps ? 6 : 5}, minmax(0, 1fr))`,
            gap: 8,
          }}
        >
          {tile(
            'Land Value',
            totalLandValue > 0 ? fmt(totalLandValue) : 'n/a',
            totalProjectGFA > 0 ? `${formatNumber(totalProjectGFA)} sqm GFA` : 'No GFA captured',
            'var(--color-success, #166534)',
          )}
          {tile(
            'Total GFA / BUA',
            totalProjectGFA > 0 ? `${formatNumber(totalProjectGFA)}` : 'n/a',
            totalProjectBUA > 0 ? `${formatNumber(totalProjectBUA)} sqm BUA` : 'sqm gross floor area',
            'var(--color-navy)',
          )}
          {tile(
            'Total CapEx',
            totalCapex > 0 ? fmt(totalCapex) : 'n/a',
            `${phaseCount} phase${phaseCount === 1 ? '' : 's'}, ${costLineCount} cost line${costLineCount === 1 ? '' : 's'}`,
            'var(--color-warning, #92400e)',
          )}
          {tile(
            'Total Funding',
            totalFunding > 0 ? fmt(totalFunding) : 'n/a',
            `${fmt(totalDebtSized)} debt + ${fmt(totalEquitySized)} equity`,
            'var(--color-navy)',
          )}
          {hasExistingOps &&
            tile(
              'Existing Operations',
              fmt(existingTotal),
              `Pre-Capex (= ${fmt(existingDebtTotal)} debt + ${fmt(existingEquityTotal)} equity)`,
              'var(--color-warning, #92400e)',
            )}
          {tile(
            'Project Duration',
            phaseCount > 0 ? `${projectDurationYears} yr` : 'n/a',
            phaseCount > 0 ? `${projectStartYear} to ${projectEndYear}` : 'Add a phase to see horizon',
            'var(--color-meta, #6b7280)',
          )}
        </div>
      </section>

      {/* ── 3. Module quick-jump deck ─────────────────────────────── */}
      <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="dashboard-modules">
        <div
          style={{
            fontSize: 11,
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--color-heading)',
            marginBottom: 'var(--sp-1)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Modules
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {moduleCards.map((m) => (
            <button
              key={m.tab}
              type="button"
              onClick={() => {
                onSelectModule('module1');
                onSelectTab(m.tab);
              }}
              data-testid={`dashboard-module-${m.tab}`}
              style={{
                textAlign: 'left',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                transition: 'border-color 120ms ease, transform 120ms ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-navy)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: 'var(--color-heading)',
                  }}
                >
                  {m.name}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{m.desc}</div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--color-navy)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginTop: 2,
                }}
              >
                {m.hint}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. Phase summary ──────────────────────────────────────── */}
      <section
        className="module-card"
        style={{ padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-3)' }}
        data-testid="dashboard-phases"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--sp-1)',
          }}
        >
          <h3
            style={{
              fontSize: 11,
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Phase Summary
          </h3>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Hover ⓘ on operational phases for existing-ops detail
          </span>
        </div>

        {phaseRows.length === 0 ? (
          <div
            style={{
              color: 'var(--color-muted)',
              fontSize: 'var(--font-meta)',
              padding: 'var(--sp-2) 0',
            }}
          >
            No phases defined. Open Setup to add a phase.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--color-grey-pale, color-mix(in srgb, var(--color-heading) 4%, transparent))' }}>
                <th style={{ textAlign: 'left',  padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>Phase</th>
                <th style={{ textAlign: 'left',  padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>Status</th>
                <th style={{ textAlign: 'left',  padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>Construction</th>
                <th style={{ textAlign: 'left',  padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>Operations</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>Assets</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)' }}>CapEx</th>
                <th style={{ textAlign: 'left',  padding: '6px 8px', fontWeight: 700, color: 'var(--color-meta)', width: 140 }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {phaseRows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`dashboard-phase-${row.id}`}
                  style={{ borderTop: '1px solid var(--color-border-light, var(--color-border))' }}
                >
                  <td style={{ padding: '6px 8px', color: 'var(--color-heading)', fontWeight: 600 }}>
                    {row.name}
                    {row.tooltip && (
                      <span
                        title={row.tooltip}
                        style={{
                          marginLeft: 6,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 14,
                          height: 14,
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: '50%',
                          background: 'color-mix(in srgb, var(--color-navy) 12%, transparent)',
                          color: 'var(--color-navy)',
                          cursor: 'help',
                        }}
                      >
                        i
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <StatusPill kind={row.statusKind} />
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--color-meta)' }}>{row.construction}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--color-meta)' }}>{row.operations}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.assetCount}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.capex)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      title={`${row.sharePct.toFixed(1)}% of total CapEx`}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 4,
                          background: 'color-mix(in srgb, var(--color-heading) 6%, transparent)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, row.sharePct)}%`,
                            height: '100%',
                            background: 'var(--color-navy)',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-meta)',
                          minWidth: 36,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {row.sharePct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--color-heading)' }}>Total</td>
                <td />
                <td />
                <td />
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-heading)' }}>
                  {assetCount}
                </td>
                <td
                  style={{
                    padding: '6px 8px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: 'var(--color-heading)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmt(totalCapex)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {/* ── 5. Reconciliation strip ──────────────────────────────── */}
      {chips.length > 0 && (
        <section
          style={{ marginBottom: 'var(--sp-3)' }}
          data-testid="dashboard-recon"
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 'var(--fw-semibold)',
              color: 'var(--color-heading)',
              marginBottom: 'var(--sp-1)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Reconciliation
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chips.map((c, i) => (
              <Chip key={i} kind={c.kind} label={c.label} title={c.title} />
            ))}
          </div>
        </section>
      )}

      {/* ── 6. Version history ───────────────────────────────────── */}
      <section
        className="module-card"
        style={{ padding: 'var(--sp-2) var(--sp-3)' }}
        data-testid="dashboard-versions"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--sp-1)',
          }}
        >
          <h3
            style={{
              fontSize: 11,
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Version History
          </h3>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            {versionsLoading
              ? 'Loading...'
              : versions.length === 0
              ? 'No versions yet'
              : `Showing ${Math.min(5, versions.length)} of ${versions.length}`}
          </span>
        </div>

        {!versionsLoading && versions.length === 0 && (
          <div
            style={{
              padding: 'var(--sp-2)',
              textAlign: 'center',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-meta)',
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 6 }}>No saved versions yet.</div>
            {can('canSave') && (
              <button
                type="button"
                className="btn-primary"
                onClick={onSaveVersion}
                style={{ padding: '4px 12px', fontSize: 12 }}
                data-testid="dashboard-versions-save-cta"
              >
                Save First Version
              </button>
            )}
          </div>
        )}

        {versions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {versions.slice(0, 5).map((v) => {
              const isActive = v.id === activeVersionId;
              const label = v.label && v.label.trim().length > 0 ? v.label : `Version ${v.version_number}`;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    if (!isActive && can('canManageVersions')) onLoadVersion(activeProjectId, v.id);
                  }}
                  data-testid={`dashboard-version-${v.id}`}
                  disabled={isActive || !can('canManageVersions')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: isActive
                      ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)'
                      : '1px solid var(--color-border)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                      : 'var(--color-surface)',
                    cursor: isActive || !can('canManageVersions') ? 'default' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--color-heading)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </span>
                      {isActive && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '1px 7px',
                            borderRadius: 20,
                            background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                            color: 'var(--color-success)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          LOADED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>
                      {relativeTime(v.created_at)} · {new Date(v.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!isActive && can('canManageVersions') && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--color-navy)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Load →
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
