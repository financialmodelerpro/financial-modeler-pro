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
  type Project,
  type ModelGranularity,
  type ProjectStatus,
} from '../../lib/state/module1-types';
import { computeProjectEndDate, computePhaseTimeline, computeProjectTimeline } from '@/src/core/calculations';
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
const MODEL_OPTIONS: ModelGranularity[] = ['monthly', 'annual'];

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
      <h2 style={{ fontSize: 'var(--font-h2)', marginBottom: 'var(--sp-3)' }}>
        1. Project &amp; Phases
      </h2>

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
        <strong>What goes here:</strong> Project identity (name, currency, granularity,
        location, status) plus the construction and operations timing for every phase.
        Land, assets, costs, and financing all hang off a phase, so set up phases first.
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
          <div>
            <InputLabel
              label="Model Granularity"
              help="Monthly = each period is 1 month. Annual = each period is 1 year (12 months bundled)."
              inputId="project-modelType"
            />
            <select
              id="project-modelType"
              data-testid="project-modelType"
              value={project.modelType}
              onChange={(e) => setProject({ modelType: e.target.value as ModelGranularity })}
              style={inputStyle}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 'monthly' ? 'Monthly' : 'Annual'}
                </option>
              ))}
            </select>
          </div>
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

  return (
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
        <input
          type="number"
          min={1}
          value={phase.constructionPeriods}
          data-testid={`phase-${phase.id}-constructionPeriods`}
          onChange={(e) => onUpdate({ constructionPeriods: Math.max(1, Number(e.target.value) || 1) })}
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
        <span style={calcOutputStyle} data-testid={`phase-${phase.id}-constructionEnd`}>
          {tl.constructionEnd}
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
  );
}
