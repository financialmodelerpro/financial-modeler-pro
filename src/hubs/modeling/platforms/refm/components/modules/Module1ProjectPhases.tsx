'use client';

/**
 * Module1ProjectPhases.tsx (M2.0 Tab 1)
 *
 * Project meta + Phase CRUD. The first thing a user sees after creating
 * a project: edit name / currency / model granularity / start date /
 * status / location, then add or adjust phases (construction window,
 * operations window, overlap).
 *
 * Phases drive every downstream tab: parcels, assets, costs, financing,
 * and equity all hang off a phaseId.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type Asset,
  type Phase,
  type PhaseHistoricalBaseline,
  type PhaseStatus,
  type Project,
  type ProjectStatus,
  type DisplayScale,
  type DisplayDecimals,
  DISPLAY_SCALES,
  DISPLAY_DECIMALS,
  PHASE_STATUSES,
  PHASE_STATUS_LABELS,
} from '../../lib/state/module1-types';
import { computeProjectEndDate, computePhaseTimeline, computeProjectTimeline } from '@/src/core/calculations';
import { currencyHeaderLine } from '@/src/core/formatters';
import InputLabel from '../ui/InputLabel';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { CELL_HEADER } from './_shared/tableStyles';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
  width: '100%',
};

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-3)',
  marginBottom: 'var(--sp-3)',
};

// Universal table header alignment standard (2026-05-13): route Tab 1's
// header through the shared CELL_HEADER token so headers stay centered
// horizontally + vertically across every Module 1 results table.
const tableHeaderStyle: React.CSSProperties = CELL_HEADER;

const tableHeaderLabelStyle: React.CSSProperties = {
  color: 'var(--color-on-primary-navy)',
  fontWeight: 'var(--fw-bold)',
};

const STATUS_OPTIONS: ProjectStatus[] = ['draft', 'active', 'archived'];

export default function Module1ProjectPhases(): React.JSX.Element {
  const { project, phases, assets, setProject, addPhase, updatePhase, removePhase, updateAsset } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      setProject: s.setProject,
      addPhase: s.addPhase,
      updatePhase: s.updatePhase,
      removePhase: s.removePhase,
      updateAsset: s.updateAsset,
    })),
  );

  const projectEndDate = useMemo(
    () => computeProjectEndDate(project, phases),
    [project, phases],
  );

  // M2.0f Fix 5: timeline drives the "Project End" caption inclusive of
  // year (endYear is end-of-last-period, no +1 offset).
  const projectTimeline = useMemo(
    () => computeProjectTimeline(project, phases),
    [project, phases],
  );

  // M2.0f Fix 4: when adding a new phase, default startDate to the prior
  // phase's constructionEnd so the next phase visually picks up where
  // the prior one stopped (matches wizard Step 2 behaviour).
  const computeNextPhaseStartDate = (): string => {
    const last = phases[phases.length - 1];
    if (!last) return project.startDate;
    const tl = computePhaseTimeline(last, project);
    return tl.constructionEnd;
  };

  const handleAddPhase = (): void => {
    const id = `phase_${Date.now()}`;
    const lastPhase = phases[phases.length - 1];
    const constructionStart = lastPhase
      ? lastPhase.constructionStart + lastPhase.constructionPeriods - lastPhase.overlapPeriods
      : 1;
    addPhase({
      id,
      name: `Phase ${phases.length + 1}`,
      constructionStart,
      constructionPeriods: 24,
      operationsPeriods: 60,
      overlapPeriods: 0,
      startDate: computeNextPhaseStartDate(),
    });
  };

  return (
    <div data-testid="tab-project-phases">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <h2 style={{ fontSize: 'var(--font-h2)', margin: 0 }}>
          1. Project &amp; Phases
        </h2>
        {/* M2.0h Fix 2 (2026-05-07): single currency / scale header
            line per tab. Cells stay free of currency suffix. */}
        <div
          style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic' }}
          data-testid="currency-header-line"
        >
          {currencyHeaderLine(project.currency, project.displayScale ?? 'full')}
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-primary-pale)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="tab1-callout"
      >
        <strong>What goes here:</strong> Project identity (name, currency,
        location, status) plus the construction and operations timing for every phase.
        Land, assets, costs, and financing all hang off a phase, so set up phases first.
      </div>

      {/* M2.0i Fix 3 (2026-05-07): Display Settings panel. Project-wide
          number formatting controls (scale + decimal places) feed every
          formatted cell across all tabs / dashboard / overview. */}
      <div style={sectionCardStyle} data-testid="display-settings">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>Display Settings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
          <div>
            <InputLabel
              label="Scale"
              help="Storage stays full value; only the display layer divides by 1,000 (Thousands) or 1,000,000 (Millions)."
            />
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {DISPLAY_SCALES.map((s) => (
                <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 'var(--font-small)' }} data-testid={`display-scale-${s}`}>
                  <input
                    type="radio"
                    name="display-scale"
                    value={s}
                    checked={(project.displayScale ?? 'full') === s}
                    onChange={() => setProject({ displayScale: s as DisplayScale })}
                  />
                  {s === 'full' ? 'Full Numbers' : s === 'thousands' ? "Thousands ('000)" : 'Millions (M)'}
                </label>
              ))}
            </div>
          </div>
          <div>
            <InputLabel
              label="Decimals"
              help="Decimal places shown after the thousand separators. 0 = round integer; 2 = standard accounting; 3 = extra precision."
            />
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {DISPLAY_DECIMALS.map((d) => (
                <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 'var(--font-small)' }} data-testid={`display-decimals-${d}`}>
                  <input
                    type="radio"
                    name="display-decimals"
                    value={d}
                    checked={(project.displayDecimals ?? 2) === d}
                    onChange={() => setProject({ displayDecimals: d as DisplayDecimals })}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={sectionCardStyle} data-testid="project-meta">
        <h3 style={{ fontSize: 'var(--font-h3)', marginBottom: 'var(--sp-2)' }}>
          Project identity
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--sp-2)',
          }}
        >
          <div>
            <InputLabel
              label="Project Name"
              help="The display name shown across the platform. Free-text."
              inputId="project-name"
            />
            <input
              id="project-name"
              data-testid="project-name"
              type="text"
              value={project.name}
              onChange={(e) => setProject({ name: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <InputLabel
              label="Currency"
              help="ISO code (e.g. SAR, USD, AED). Single currency per project; multi-currency support is M3+."
              inputId="project-currency"
            />
            <input
              id="project-currency"
              data-testid="project-currency"
              type="text"
              value={project.currency}
              onChange={(e) => setProject({ currency: e.target.value.toUpperCase().slice(0, 4) })}
              style={inputStyle}
            />
          </div>
          {/* M2.0i Fix 1 (2026-05-07): Model Granularity input dropped.
              All inputs are entered annually (M2.0g architecture); the
              previous monthly option now lives only as legacy schema
              compat. Output view granularity (Annual / Quarterly /
              Monthly) toggles on Tab 3 Costs Results sub-tab. */}
          <div>
            <InputLabel
              label="Project Start Date"
              help="The first calendar day of period 1. End date derives from longest phase."
              inputId="project-startDate"
            />
            <input
              id="project-startDate"
              data-testid="project-startDate"
              type="date"
              value={project.startDate}
              onChange={(e) => setProject({ startDate: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <InputLabel
              label="Project Status"
              help="Draft = not yet committed. Active = under development. Archived = read-only."
              inputId="project-status"
            />
            <select
              id="project-status"
              data-testid="project-status"
              value={project.status}
              onChange={(e) => setProject({ status: e.target.value as ProjectStatus })}
              style={inputStyle}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <InputLabel
              label="Location"
              help="Free-text city / country / region. Display only."
              inputId="project-location"
            />
            <input
              id="project-location"
              data-testid="project-location"
              type="text"
              value={project.location}
              onChange={(e) => setProject({ location: e.target.value })}
              style={inputStyle}
              placeholder="Riyadh, Saudi Arabia"
            />
          </div>
        </div>
        <div
          style={{
            marginTop: 'var(--sp-2)',
            fontSize: 'var(--font-small)',
            color: 'var(--color-meta)',
          }}
          data-testid="project-end-formula"
        >
          Project End = {project.startDate} + max phase duration = <strong>{projectEndDate}</strong> (end year <strong data-testid="project-end-year">{projectTimeline.endYear}</strong>, total <strong>{projectTimeline.totalPeriods}</strong> {'years'})
        </div>
      </div>

      {/* P8-Fix 1 (2026-05-12): NDA card moved to Tab 2 Assets & Sub-units
          (lives below the Land Parcels totals row). Tab 1 stays focused
          on project identity + phases. project.projectNdaEnabled +
          projectRoadsPct + projectParksPct + projectNdaScope are
          edited in the Tab 2 NDA card now. */}

      <div style={sectionCardStyle} data-testid="phases-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Phases</h3>
          <button
            type="button"
            onClick={handleAddPhase}
            data-testid="add-phase"
            className="btn-primary"
            style={{
              padding: 'var(--sp-1) var(--sp-2)',
              fontSize: 'var(--font-small)',
            }}
          >
            + Add Phase
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>
                <InputLabel label="Phase Name" help="Free-text label." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Phase Start Date" help="ISO date (YYYY-MM-DD). Authoritative timing source. Wizard Step 2 captures this; editing it here cascades to all downstream calcs (cost phasing, financing, project end)." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Construction (${'years'})`} help="How many periods the build phase spans." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Operations (${'years'})`} help="How long the asset operates / generates revenue after delivery." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Overlap (${'years'})`} help="Periods where operations begin before construction ends (e.g. tower 1 opens during tower 2 build)." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Construction End" help="Auto-derived = Phase Start Date + Construction Periods." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Operations Start" help="Auto-derived = Construction End - Overlap Periods." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Operations End" help="Auto-derived = Operations Start + Operations Periods. Also the phase's contribution to Project End." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Status" help="Planning / Construction / Operational. When Operational, a Historical Baseline section appears beneath the row for sunk costs + opening balances." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}></th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                project={project}
                phaseAssets={assets.filter((a) => a.phaseId === phase.id && a.visible)}
                onUpdate={(patch) => updatePhase(phase.id, patch)}
                onUpdateAsset={updateAsset}
                onRemove={() => removePhase(phase.id)}
                canRemove={phases.length > 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PhaseRowProps {
  phase: Phase;
  project: Project;
  phaseAssets: Asset[];
  onUpdate: (patch: Partial<Phase>) => void;
  onUpdateAsset: (id: string, patch: Partial<Asset>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

const calcOutputStyle: React.CSSProperties = {
  padding: 'var(--sp-1)',
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-small)',
  display: 'inline-block',
  minWidth: 92,
};

function PhaseRow({ phase, project, phaseAssets, onUpdate, onUpdateAsset, onRemove, canRemove }: PhaseRowProps): React.JSX.Element {
  // M2.0f Fix 4: phase start date is the authoritative timing field.
  // Computed end dates derive via computePhaseTimeline so editing
  // start date here cascades to construction end / operations
  // start / operations end and downstream calcs.
  const tl = computePhaseTimeline(phase, project);
  // M2.0f Fix 4: when blank, default to project.startDate so legacy v7
  // snapshots without phase.startDate render a usable date instead of
  // empty. The user can edit; saving writes the value back.
  const startDateValue = phase.startDate && phase.startDate.length === 10
    ? phase.startDate
    : project.startDate;

  // M2.0i Fix 10: phase status drives the Historical Baseline reveal.
  const status: PhaseStatus = phase.status ?? 'planning';
  const isOperational = status === 'operational';

  // Default historical baseline when user toggles to Operational and
  // hasn't filled the form yet. All zeros so nothing accidentally
  // affects downstream calcs until the user enters real numbers.
  // Pass 38 (2026-05-14): trimmed to opening-BS items only. Per-asset
  // Pre-Capex / Existing Debt / Existing Equity feed the engine; sunk-
  // cost roll-ups + run-rate metrics moved to a future Historical
  // Financials panel under the Financials module. Old fields are kept
  // optional in the schema so legacy snapshots still parse but are not
  // rendered or read.
  const baseline: PhaseHistoricalBaseline = phase.historicalBaseline ?? {
    historicalCapexTotal: 0,
    historicalEquityContributed: 0,
    historicalDebtDrawn: 0,
    currentDebtOutstanding: 0,
    cumulativeDepreciationCharged: 0,
    netBookValueFixedAssets: 0,
    last12MonthsRevenue: 0,
    last12MonthsOpex: 0,
  };

  const setBaseline = (patch: Partial<PhaseHistoricalBaseline>): void => {
    onUpdate({ historicalBaseline: { ...baseline, ...patch } });
  };

  return (
    <React.Fragment>
    <tr data-testid={`phase-row-${phase.id}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="text"
          value={phase.name}
          data-testid={`phase-${phase.id}-name`}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="date"
          value={startDateValue}
          data-testid={`phase-${phase.id}-startDate`}
          onChange={(e) => onUpdate({ startDate: e.target.value })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        {/* M2.0j Fix 1: allow 0 construction years (operational phase). */}
        <AccountingNumberInput
          value={phase.constructionPeriods}
          onChange={(n) => onUpdate({ constructionPeriods: Math.max(0, n) })}
          min={0}
          scale="full"
          decimals={0}
          data-testid={`phase-${phase.id}-constructionPeriods`}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <AccountingNumberInput
          value={phase.operationsPeriods}
          onChange={(n) => onUpdate({ operationsPeriods: Math.max(0, n) })}
          min={0}
          scale="full"
          decimals={0}
          data-testid={`phase-${phase.id}-operationsPeriods`}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <AccountingNumberInput
          value={phase.overlapPeriods}
          onChange={(n) => onUpdate({ overlapPeriods: Math.max(0, Math.min(phase.constructionPeriods, n)) })}
          min={0}
          max={phase.constructionPeriods}
          scale="full"
          decimals={0}
          data-testid={`phase-${phase.id}-overlapPeriods`}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        {/* M2.0j Fix 1: when constructionPeriods=0 show "Operational from start"
            instead of a misleading construction end date. */}
        <span style={calcOutputStyle} data-testid={`phase-${phase.id}-constructionEnd`}>
          {phase.constructionPeriods === 0 ? 'Operational from start' : tl.constructionEnd}
        </span>
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <span style={calcOutputStyle} data-testid={`phase-${phase.id}-operationsStart`}>
          {tl.operationsStart}
        </span>
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <span style={calcOutputStyle} data-testid={`phase-${phase.id}-operationsEnd`}>
          {tl.operationsEnd}
        </span>
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <select
          value={status}
          data-testid={`phase-${phase.id}-status`}
          onChange={(e) => onUpdate({ status: e.target.value as PhaseStatus })}
          style={inputStyle}
        >
          {PHASE_STATUSES.map((s) => (
            <option key={s} value={s}>{PHASE_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`phase-${phase.id}-remove`}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
    {/* M2.0i Fix 10: Historical Baseline section. Only renders when
        phase.status === 'operational'. Spans the table width as a
        nested grid; data preserved in the schema even when status
        toggles back to non-operational, in case user re-toggles. */}
    {isOperational && (
      <tr data-testid={`phase-${phase.id}-historical-baseline`}>
        <td colSpan={10} style={{ padding: 'var(--sp-2)', background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)', borderBottom: '1px solid var(--color-border)' }}>
          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', display: 'block', marginBottom: 'var(--sp-1)' }}>
            Historical Baseline (operational phase)
          </strong>
          {/* Pass 38 (2026-05-14): opening balance sheet items only.
              Per-asset Pre-Capex / Existing Debt / Existing Equity (below)
              feed the engine for sunk-cost / equity-contributed totals.
              Sunk-cost roll-ups + run-rate metrics will move to a
              dedicated Historical Financials panel under the Financials
              module. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', fontSize: 11 }}>
            <div style={{ gridColumn: '1 / span 3', color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Opening balance sheet at project Y0</div>
            <div>
              <InputLabel label="Current Debt Outstanding" help="Outstanding loan balance at reporting start. Auto-pulled into the Existing Facility Opening Balance on Tab 4." inputId={`phase-${phase.id}-hist-debt-out`} />
              <AccountingNumberInput id={`phase-${phase.id}-hist-debt-out`} data-testid={`phase-${phase.id}-hist-debt-out`} min={0} value={baseline.currentDebtOutstanding} onChange={(n) => setBaseline({ currentDebtOutstanding: Math.max(0, n) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Cumulative Depreciation" help="Depreciation already charged on existing fixed assets. Seeds the BS accumulated depreciation balance at Y0." inputId={`phase-${phase.id}-hist-depr`} />
              <AccountingNumberInput id={`phase-${phase.id}-hist-depr`} data-testid={`phase-${phase.id}-hist-depr`} min={0} value={baseline.cumulativeDepreciationCharged} onChange={(n) => setBaseline({ cumulativeDepreciationCharged: Math.max(0, n) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Net Book Value (Fixed Assets)" help="NBV of existing fixed assets at reporting start. Seeds the BS Property/Plant/Equipment balance at Y0." inputId={`phase-${phase.id}-hist-nbv`} />
              <AccountingNumberInput id={`phase-${phase.id}-hist-nbv`} data-testid={`phase-${phase.id}-hist-nbv`} min={0} value={baseline.netBookValueFixedAssets} onChange={(n) => setBaseline({ netBookValueFixedAssets: Math.max(0, n) })} style={inputStyle} />
            </div>
          </div>
          {/* M2.0 Pass 15 (2026-05-13): per-asset Historical Baseline.
              For each operational-phase asset, capture Pre-Capex,
              Existing Debt, Existing Equity with a validation chip.
              Pre-Capex feeds Tab 4 Capex Breakdown prior column; Debt
              feeds Total Debt Required prior; Equity feeds Equity
              Required prior. */}
          {phaseAssets.length > 0 && (
            <div data-testid={`phase-${phase.id}-asset-baselines`} style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px dashed var(--color-border)' }}>
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', display: 'block', marginBottom: 'var(--sp-1)' }}>
                Per-asset Historical Baseline
              </strong>
              <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                {phaseAssets.map((a) => {
                  const pre = Math.max(0, a.historicalPreCapex ?? 0);
                  const debt = Math.max(0, a.historicalDebtAmount ?? 0);
                  const equity = Math.max(0, a.historicalEquityAmount ?? 0);
                  const diff = pre - (debt + equity);
                  const balances = Math.abs(diff) < 1;
                  const equityNeededToBalance = Math.max(0, pre - debt);
                  return (
                    <div key={a.id} data-testid={`asset-${a.id}-baseline`} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.3fr', gap: 'var(--sp-1)', alignItems: 'end', fontSize: 11, padding: 'var(--sp-1)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asset</div>
                        <div style={{ fontWeight: 700 }}>{a.name}</div>
                      </div>
                      <div>
                        <InputLabel label="Pre-Capex" help="Historical capex sunk into this asset before project start." inputId={`asset-${a.id}-pre-capex`} />
                        <AccountingNumberInput id={`asset-${a.id}-pre-capex`} data-testid={`asset-${a.id}-pre-capex`} min={0} value={pre} onChange={(n) => onUpdateAsset(a.id, { historicalPreCapex: Math.max(0, n) })} style={inputStyle} />
                      </div>
                      <div>
                        <InputLabel label="Existing Debt" help="Debt outstanding at project Y0 for this asset." inputId={`asset-${a.id}-hist-debt`} />
                        <AccountingNumberInput id={`asset-${a.id}-hist-debt`} data-testid={`asset-${a.id}-hist-debt`} min={0} value={debt} onChange={(n) => onUpdateAsset(a.id, { historicalDebtAmount: Math.max(0, n) })} style={inputStyle} />
                      </div>
                      <div>
                        <InputLabel label="Existing Equity" help="Equity contributed to date for this asset (cash + in-kind combined)." inputId={`asset-${a.id}-hist-equity`} />
                        <AccountingNumberInput id={`asset-${a.id}-hist-equity`} data-testid={`asset-${a.id}-hist-equity`} min={0} value={equity} onChange={(n) => onUpdateAsset(a.id, { historicalEquityAmount: Math.max(0, n) })} style={inputStyle} />
                      </div>
                      <div
                        data-testid={`asset-${a.id}-baseline-chip`}
                        title={
                          balances
                            ? `Pre-Capex ${pre} = Debt ${debt} + Equity ${equity}.`
                            : `Pre-Capex ${pre} should equal Debt ${debt} + Equity ${equity}. Difference: ${diff.toFixed(0)}. Equity should be ${equityNeededToBalance.toFixed(0)} to balance.`
                        }
                        style={{
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontWeight: 700,
                          textAlign: 'center',
                          background: balances
                            ? 'color-mix(in srgb, var(--color-success) 16%, transparent)'
                            : 'color-mix(in srgb, var(--color-accent-warm) 16%, transparent)',
                          color: balances ? 'var(--color-success)' : 'var(--color-accent-warm)',
                          fontSize: 11,
                        }}
                      >
                        {balances
                          ? 'Balances'
                          : `Mismatch: equity should be ${equityNeededToBalance.toLocaleString()} to balance`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </td>
      </tr>
    )}
    </React.Fragment>
  );
}
