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

const tableHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  textAlign: 'left',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  textTransform: 'uppercase',
};

const tableHeaderLabelStyle: React.CSSProperties = {
  color: 'var(--color-on-primary-navy)',
  fontWeight: 'var(--fw-bold)',
};

const STATUS_OPTIONS: ProjectStatus[] = ['draft', 'active', 'archived'];

export default function Module1ProjectPhases(): React.JSX.Element {
  const { project, phases, setProject, addPhase, updatePhase, removePhase } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      setProject: s.setProject,
      addPhase: s.addPhase,
      updatePhase: s.updatePhase,
      removePhase: s.removePhase,
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

      {/* M2.0M Pass 6 Fix 3 (2026-05-11): project-level NDA deduction.
          Replaces the per-parcel toggle in Tab 2. When enabled, applies
          (roads% + parks%) uniformly to TOTAL phase land area when
          deriving NDA for the rate_per_nda / rate_per_roads cost methods. */}
      <div style={sectionCardStyle} data-testid="project-nda">
        <h3 style={{ fontSize: 'var(--font-h3)', marginBottom: 'var(--sp-2)' }}>
          Roads + Parks Deduction (NDA)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-small)', cursor: 'pointer' }} data-testid="project-nda-toggle-label">
            <input
              type="checkbox"
              data-testid="project-nda-enabled"
              checked={project.projectNdaEnabled === true}
              onChange={(e) => setProject({ projectNdaEnabled: e.target.checked })}
            />
            Apply Roads/Parks Deduction
          </label>
          <div>
            <InputLabel label="Roads %" help="Project-wide share of total land area reserved for roads. Applied uniformly to phase land when the deduction is enabled." />
            <input
              type="number" min={0} max={100}
              data-testid="project-roads-pct"
              value={project.projectRoadsPct ?? 0}
              onChange={(e) => setProject({ projectRoadsPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
              disabled={project.projectNdaEnabled !== true}
              style={{ ...inputStyle, opacity: project.projectNdaEnabled !== true ? 0.6 : 1 }}
            />
          </div>
          <div>
            <InputLabel label="Parks %" help="Project-wide share of total land area reserved for parks / green space." />
            <input
              type="number" min={0} max={100}
              data-testid="project-parks-pct"
              value={project.projectParksPct ?? 0}
              onChange={(e) => setProject({ projectParksPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
              disabled={project.projectNdaEnabled !== true}
              style={{ ...inputStyle, opacity: project.projectNdaEnabled !== true ? 0.6 : 1 }}
            />
          </div>
        </div>
        {project.projectNdaEnabled === true && (
          <div style={{ marginTop: 'var(--sp-1)', fontSize: 'var(--font-small)', color: 'var(--color-meta)' }} data-testid="project-nda-summary">
            NDA = total land area x (1 - {Math.min(100, (project.projectRoadsPct ?? 0) + (project.projectParksPct ?? 0))}% deducted). Per-parcel NDA toggles in Tab 2 are ignored while this is enabled.
          </div>
        )}
      </div>

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
                onUpdate={(patch) => updatePhase(phase.id, patch)}
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
  onUpdate: (patch: Partial<Phase>) => void;
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

function PhaseRow({ phase, project, onUpdate, onRemove, canRemove }: PhaseRowProps): React.JSX.Element {
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
        <input
          type="number"
          min={0}
          value={phase.constructionPeriods}
          data-testid={`phase-${phase.id}-constructionPeriods`}
          onChange={(e) => onUpdate({ constructionPeriods: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          value={phase.operationsPeriods}
          data-testid={`phase-${phase.id}-operationsPeriods`}
          onChange={(e) => onUpdate({ operationsPeriods: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          max={phase.constructionPeriods}
          value={phase.overlapPeriods}
          data-testid={`phase-${phase.id}-overlapPeriods`}
          onChange={(e) =>
            onUpdate({
              overlapPeriods: Math.max(0, Math.min(phase.constructionPeriods, Number(e.target.value) || 0)),
            })
          }
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', fontSize: 11 }}>
            <div style={{ gridColumn: '1 / span 3', color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sunk costs + prior cumulative</div>
            <div>
              <InputLabel label="Historical Capex Total" help="Total capex spent before reporting start (sunk cost)." inputId={`phase-${phase.id}-hist-capex`} />
              <input id={`phase-${phase.id}-hist-capex`} data-testid={`phase-${phase.id}-hist-capex`} type="number" min={0} value={baseline.historicalCapexTotal} onChange={(e) => setBaseline({ historicalCapexTotal: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Historical Equity Contributed" help="Equity already invested before reporting start." inputId={`phase-${phase.id}-hist-equity`} />
              <input id={`phase-${phase.id}-hist-equity`} data-testid={`phase-${phase.id}-hist-equity`} type="number" min={0} value={baseline.historicalEquityContributed} onChange={(e) => setBaseline({ historicalEquityContributed: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Historical Debt Drawn" help="Total debt drawn before reporting start." inputId={`phase-${phase.id}-hist-debt-drawn`} />
              <input id={`phase-${phase.id}-hist-debt-drawn`} data-testid={`phase-${phase.id}-hist-debt-drawn`} type="number" min={0} value={baseline.historicalDebtDrawn} onChange={(e) => setBaseline({ historicalDebtDrawn: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Current Debt Outstanding" help="Outstanding balance after historical repayments." inputId={`phase-${phase.id}-hist-debt-out`} />
              <input id={`phase-${phase.id}-hist-debt-out`} data-testid={`phase-${phase.id}-hist-debt-out`} type="number" min={0} value={baseline.currentDebtOutstanding} onChange={(e) => setBaseline({ currentDebtOutstanding: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Cumulative Depreciation" help="Depreciation already charged on existing fixed assets." inputId={`phase-${phase.id}-hist-depr`} />
              <input id={`phase-${phase.id}-hist-depr`} data-testid={`phase-${phase.id}-hist-depr`} type="number" min={0} value={baseline.cumulativeDepreciationCharged} onChange={(e) => setBaseline({ cumulativeDepreciationCharged: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Net Book Value (Fixed Assets)" help="NBV of existing fixed assets at reporting start." inputId={`phase-${phase.id}-hist-nbv`} />
              <input id={`phase-${phase.id}-hist-nbv`} data-testid={`phase-${phase.id}-hist-nbv`} type="number" min={0} value={baseline.netBookValueFixedAssets} onChange={(e) => setBaseline({ netBookValueFixedAssets: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', fontSize: 11 }}>
            <div style={{ gridColumn: '1 / span 3', color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current operating run-rate (last 12 months)</div>
            <div>
              <InputLabel label="Last 12 Months Revenue" help="Trailing 12-month revenue at reporting start." inputId={`phase-${phase.id}-hist-revenue`} />
              <input id={`phase-${phase.id}-hist-revenue`} data-testid={`phase-${phase.id}-hist-revenue`} type="number" min={0} value={baseline.last12MonthsRevenue} onChange={(e) => setBaseline({ last12MonthsRevenue: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Last 12 Months Opex" help="Trailing 12-month operating expenses at reporting start." inputId={`phase-${phase.id}-hist-opex`} />
              <input id={`phase-${phase.id}-hist-opex`} data-testid={`phase-${phase.id}-hist-opex`} type="number" min={0} value={baseline.last12MonthsOpex} onChange={(e) => setBaseline({ last12MonthsOpex: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Current Occupancy %" help="Current occupancy rate (hospitality / lease, optional)." inputId={`phase-${phase.id}-hist-occ`} />
              <input id={`phase-${phase.id}-hist-occ`} data-testid={`phase-${phase.id}-hist-occ`} type="number" min={0} max={100} value={baseline.currentOccupancy ?? 0} onChange={(e) => { const v = Number(e.target.value); setBaseline({ currentOccupancy: v > 0 ? Math.min(100, v) : undefined }); }} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Current ADR" help="Average Daily Rate per key per night (hospitality, optional)." inputId={`phase-${phase.id}-hist-adr`} />
              <input id={`phase-${phase.id}-hist-adr`} data-testid={`phase-${phase.id}-hist-adr`} type="number" min={0} value={baseline.currentAdr ?? 0} onChange={(e) => { const v = Number(e.target.value); setBaseline({ currentAdr: v > 0 ? v : undefined }); }} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Current Rent Rate" help="Per sqm per year rent rate (lease, optional)." inputId={`phase-${phase.id}-hist-rent`} />
              <input id={`phase-${phase.id}-hist-rent`} data-testid={`phase-${phase.id}-hist-rent`} type="number" min={0} value={baseline.currentRentRate ?? 0} onChange={(e) => { const v = Number(e.target.value); setBaseline({ currentRentRate: v > 0 ? v : undefined }); }} style={inputStyle} />
            </div>
          </div>
        </td>
      </tr>
    )}
    </React.Fragment>
  );
}
