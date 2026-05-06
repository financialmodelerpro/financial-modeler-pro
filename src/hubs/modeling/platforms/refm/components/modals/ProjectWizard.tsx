'use client';

/**
 * ProjectWizard.tsx (v5 schema, M2.0)
 *
 * 3-step modal walk that mints a new project:
 *
 *   1. Basics:    name, currency, modelType, startDate, location
 *   2. Phases & land: per-phase timing + land parcels with rate
 *      and cash/in-kind split + landAllocationMode
 *   3. Assets:    seed asset list with strategy + type + areas +
 *      one default sub-unit each
 *
 * Output flows through buildWizardSnapshot to produce a complete
 * v5 HydrateSnapshot. Mounted via createPortal so the modal escapes
 * any ancestor containing-block.
 *
 * Em-dash rule: NEVER use em-dashes (CLAUDE.md writing rule, M1.11).
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  type WizardDraft,
  type WizardDraftPhase,
  type WizardDraftParcel,
  makeDefaultWizardDraft,
} from '../../lib/wizard/buildWizardSnapshot';
import {
  type LandAllocationMode,
  type OutputGranularity,
  type ProjectType,
  type DisplayScale,
  PROJECT_TYPES,
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE,
  LAND_ALLOCATION_MODES,
  DISPLAY_SCALES,
  DISPLAY_SCALE_LABELS,
  OUTPUT_GRANULARITIES,
  OUTPUT_GRANULARITY_LABELS,
} from '../../lib/state/module1-types';

export type { WizardDraft } from '../../lib/wizard/buildWizardSnapshot';

interface ProjectWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: WizardDraft) => void;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
  marginBottom: 4,
};

export default function ProjectWizard({
  open,
  onClose,
  onCreate,
}: ProjectWizardProps): React.JSX.Element | null {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<WizardDraft>(() => makeDefaultWizardDraft());

  useEffect(() => {
    if (open) {
      setStep(1);
      setDraft(makeDefaultWizardDraft());
    }
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const update = (patch: Partial<WizardDraft>): void => setDraft((d) => ({ ...d, ...patch }));

  const handleCreate = (): void => {
    onCreate(draft);
    onClose();
  };

  const step1Valid = draft.projectName.trim() !== '' && draft.currency.trim() !== '';
  const step2Valid =
    draft.phases.every((p) => p.constructionPeriods > 0 && p.operationsPeriods >= 0 && p.startDate.length === 10) &&
    draft.parcels.every(
      (p) => p.area > 0 && p.rate > 0 && Math.abs(p.cashPct + p.inKindPct - 100) < 0.1,
    );
  // M2.0e: Step 3 simplified to a single project-type pick. PROJECT_TYPES
  // closed enum guarantees draft.projectType is always one of the valid
  // slots; the gate just confirms a selection exists (always true after
  // makeDefaultWizardDraft).
  const step3Valid = PROJECT_TYPES.includes(draft.projectType);

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="project-wizard"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-3)',
          maxWidth: 1080,
          width: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="project-wizard-body"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <h2 style={{ margin: 0 }}>Create Project</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="wizard-close"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 12px',
              cursor: 'pointer',
            }}
          >
            x
          </button>
        </div>

        <div
          data-testid="wizard-stepper"
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-3)',
            fontSize: 'var(--font-small)',
          }}
        >
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              data-testid={`wizard-step-${s}`}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                background: step === s ? 'var(--color-navy)' : 'transparent',
                color: step === s ? 'var(--color-on-primary-navy)' : 'var(--color-meta)',
                border: '1px solid var(--color-border)',
              }}
            >
              {s === 1 && '1. Basics'}
              {s === 2 && '2. Phases & Land'}
              {s === 3 && '3. Project Type'}
            </div>
          ))}
        </div>

        {step === 1 && <Step1 draft={draft} onUpdate={update} />}
        {step === 2 && <Step2 draft={draft} onUpdate={update} />}
        {step === 3 && <Step3 draft={draft} onUpdate={update} />}

        <div
          style={{
            marginTop: 'var(--sp-3)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)}
            disabled={step === 1}
            data-testid="wizard-back"
            style={{
              padding: 'var(--sp-1) var(--sp-2)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              cursor: step === 1 ? 'not-allowed' : 'pointer',
              opacity: step === 1 ? 0.5 : 1,
            }}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(3, s + 1) as 1 | 2 | 3)}
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              data-testid="wizard-next"
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={!step3Valid}
              data-testid="wizard-create"
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function Step1({
  draft,
  onUpdate,
}: {
  draft: WizardDraft;
  onUpdate: (patch: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  return (
    <div data-testid="wizard-step-1-content">
      <div
        style={{
          background: 'var(--color-grey-pale)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
          fontSize: 'var(--font-small)',
          color: 'var(--color-meta)',
        }}
        data-testid="wiz-step1-instruction"
      >
        Enter all values as full numbers (e.g. 98,450 not 98.45). Pick a
        Display Scale below to view results in thousands or millions; the
        underlying storage stays full value either way.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 'var(--sp-2)',
        }}
      >
        <div>
          <label style={labelStyle} htmlFor="wiz-projectName">Project Name</label>
          <input
            id="wiz-projectName"
            data-testid="wiz-projectName"
            type="text"
            value={draft.projectName}
            onChange={(e) => onUpdate({ projectName: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="wiz-currency">Currency</label>
          <input
            id="wiz-currency"
            data-testid="wiz-currency"
            type="text"
            value={draft.currency}
            onChange={(e) => onUpdate({ currency: e.target.value.toUpperCase().slice(0, 4) })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="wiz-outputGranularity">Reporting Granularity</label>
          <select
            id="wiz-outputGranularity"
            data-testid="wiz-outputGranularity"
            value={draft.outputGranularity}
            onChange={(e) => onUpdate({ outputGranularity: e.target.value as OutputGranularity })}
            style={inputStyle}
          >
            {OUTPUT_GRANULARITIES.map((g) => (
              <option key={g} value={g}>{OUTPUT_GRANULARITY_LABELS[g]}</option>
            ))}
          </select>
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginTop: 4 }}>
            All inputs are entered annually. Choose how you want results displayed.
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="wiz-startDate">Project Start Date</label>
          <input
            id="wiz-startDate"
            data-testid="wiz-startDate"
            type="date"
            value={draft.startDate}
            onChange={(e) => onUpdate({ startDate: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={{ gridColumn: '1 / span 2' }}>
          <label style={labelStyle} htmlFor="wiz-location">Location</label>
          <input
            id="wiz-location"
            data-testid="wiz-location"
            type="text"
            value={draft.location}
            onChange={(e) => onUpdate({ location: e.target.value })}
            style={inputStyle}
            placeholder="Riyadh, Saudi Arabia"
          />
        </div>
        <div style={{ gridColumn: '1 / span 2' }} data-testid="wiz-displayScale-block">
          <label style={labelStyle}>Display Scale</label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {DISPLAY_SCALES.map((s) => (
              <label key={s} data-testid={`wiz-displayScale-${s}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 'var(--font-small)' }}>
                <input
                  type="radio"
                  name="wiz-displayScale"
                  value={s}
                  checked={draft.displayScale === s}
                  onChange={() => onUpdate({ displayScale: s as DisplayScale })}
                />
                {DISPLAY_SCALE_LABELS[s]}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step2({
  draft,
  onUpdate,
}: {
  draft: WizardDraft;
  onUpdate: (patch: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const updatePhase = (idx: number, patch: Partial<WizardDraftPhase>): void => {
    onUpdate({ phases: draft.phases.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  };
  // M2.0e: default a new phase's startDate = previous phase's
  // construction-end date (or project.startDate when first). The next
  // phase visually picks up where the prior one stopped. M2.0g v8:
  // always year arithmetic since inputs are always annual.
  const computeNextPhaseStartDate = (): string => {
    const prior = draft.phases[draft.phases.length - 1];
    if (!prior || !prior.startDate) return draft.startDate;
    const d = new Date(prior.startDate);
    if (Number.isNaN(d.getTime())) return draft.startDate;
    d.setFullYear(d.getFullYear() + Math.max(0, prior.constructionPeriods));
    return d.toISOString().slice(0, 10);
  };
  const addPhase = (): void => {
    onUpdate({
      phases: [
        ...draft.phases,
        { name: `Phase ${draft.phases.length + 1}`, startDate: computeNextPhaseStartDate(), constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 },
      ],
    });
  };
  const removePhase = (idx: number): void => {
    if (draft.phases.length <= 1) return;
    onUpdate({ phases: draft.phases.filter((_, i) => i !== idx) });
  };

  const updateParcel = (idx: number, patch: Partial<WizardDraftParcel>): void => {
    onUpdate({ parcels: draft.parcels.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  };
  const addParcel = (): void => {
    onUpdate({
      parcels: [
        ...draft.parcels,
        { name: `Land ${draft.parcels.length + 1}`, area: 50000, rate: 500, cashPct: 60, inKindPct: 40 },
      ],
    });
  };
  const removeParcel = (idx: number): void => {
    if (draft.parcels.length <= 1) return;
    onUpdate({ parcels: draft.parcels.filter((_, i) => i !== idx) });
  };

  // M2.0g v8 (Addendum 3): inputs always entered in years. The
  // M2.0e dynamic "(years/months)" suffix retires; period units are
  // permanently years on inputs.
  const periodUnit = 'years';

  return (
    <div data-testid="wizard-step-2-content">
      <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)' }}>Phases</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--sp-2)' }} data-testid="wiz-phases-table">
        <thead>
          <tr style={{ background: 'var(--color-grey-pale)' }}>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Name</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }} data-testid="wiz-phase-header-startdate">Phase Start Date</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }} data-testid="wiz-phase-header-construction">Construction ({periodUnit})</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }} data-testid="wiz-phase-header-operations">Operations ({periodUnit})</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }} data-testid="wiz-phase-header-overlap">Overlap ({periodUnit})</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {draft.phases.map((p, idx) => (
            <tr key={idx} data-testid={`wiz-phase-row-${idx}`}>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="text"
                  data-testid={`wiz-phase-${idx}-name`}
                  value={p.name}
                  onChange={(e) => updatePhase(idx, { name: e.target.value })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="date"
                  data-testid={`wiz-phase-${idx}-startDate`}
                  value={p.startDate}
                  onChange={(e) => updatePhase(idx, { startDate: e.target.value })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={1}
                  data-testid={`wiz-phase-${idx}-constructionPeriods`}
                  value={p.constructionPeriods}
                  onChange={(e) => updatePhase(idx, { constructionPeriods: Math.max(1, Number(e.target.value) || 1) })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  data-testid={`wiz-phase-${idx}-operationsPeriods`}
                  value={p.operationsPeriods}
                  onChange={(e) => updatePhase(idx, { operationsPeriods: Math.max(0, Number(e.target.value) || 0) })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  data-testid={`wiz-phase-${idx}-overlapPeriods`}
                  value={p.overlapPeriods}
                  onChange={(e) => updatePhase(idx, { overlapPeriods: Math.max(0, Number(e.target.value) || 0) })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                {draft.phases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePhase(idx)}
                    data-testid={`wiz-phase-${idx}-remove`}
                    style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                  >
                    x
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addPhase}
        data-testid="wiz-add-phase"
        style={{ marginBottom: 'var(--sp-3)', padding: 'var(--sp-1) var(--sp-2)', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
      >
        + Add Phase
      </button>

      <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)' }}>Land Parcels</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--sp-2)' }}>
        <thead>
          <tr style={{ background: 'var(--color-grey-pale)' }}>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Name</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Area (sqm)</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Rate</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Cash %</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>In-Kind %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {draft.parcels.map((p, idx) => (
            <tr key={idx} data-testid={`wiz-parcel-row-${idx}`}>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="text"
                  data-testid={`wiz-parcel-${idx}-name`}
                  value={p.name}
                  onChange={(e) => updateParcel(idx, { name: e.target.value })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  data-testid={`wiz-parcel-${idx}-area`}
                  value={p.area}
                  onChange={(e) => updateParcel(idx, { area: Math.max(0, Number(e.target.value) || 0) })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  data-testid={`wiz-parcel-${idx}-rate`}
                  value={p.rate}
                  onChange={(e) => updateParcel(idx, { rate: Math.max(0, Number(e.target.value) || 0) })}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  data-testid={`wiz-parcel-${idx}-cashPct`}
                  value={p.cashPct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    updateParcel(idx, { cashPct: v, inKindPct: 100 - v });
                  }}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  data-testid={`wiz-parcel-${idx}-inKindPct`}
                  value={p.inKindPct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    updateParcel(idx, { inKindPct: v, cashPct: 100 - v });
                  }}
                  style={inputStyle}
                />
              </td>
              <td style={{ padding: 'var(--sp-1)' }}>
                {draft.parcels.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeParcel(idx)}
                    data-testid={`wiz-parcel-${idx}-remove`}
                    style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                  >
                    x
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addParcel}
        data-testid="wiz-add-parcel"
        style={{ marginBottom: 'var(--sp-3)', padding: 'var(--sp-1) var(--sp-2)', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
      >
        + Add Parcel
      </button>

      <div style={{ marginBottom: 'var(--sp-2)' }}>
        <label style={labelStyle} htmlFor="wiz-landAllocationMode">Land Allocation Mode</label>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {LAND_ALLOCATION_MODES.map((mode) => (
            <label key={mode} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} data-testid={`wiz-land-mode-${mode}`}>
              <input
                type="radio"
                name="wiz-land-allocation-mode"
                value={mode}
                checked={draft.landAllocationMode === mode}
                onChange={() => onUpdate({ landAllocationMode: mode as LandAllocationMode })}
              />
              {mode === 'sqm' && 'A. Direct sqm'}
              {mode === 'percent' && 'B. Percent split'}
              {mode === 'autoByBua' && 'C. Auto by BUA'}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// M2.0e: Step 3 collapses from full asset detail entry into a single
// project-type pick. The user picks once; Tab 2 (Module1Assets) is the
// canonical asset entry surface and uses ASSET_TYPES_BY_PROJECT_TYPE
// to filter the type catalog. No assets are auto-created; phase
// headers in Tab 2 print SUGGESTED_CATEGORIES_BY_PROJECT_TYPE so the
// user has direction without surprise content.
function Step3({
  draft,
  onUpdate,
}: {
  draft: WizardDraft;
  onUpdate: (patch: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const suggestions = SUGGESTED_CATEGORIES_BY_PROJECT_TYPE[draft.projectType] ?? [];
  return (
    <div data-testid="wizard-step-3-content">
      <div
        style={{
          background: 'var(--color-primary-pale)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="wiz-step3-callout"
      >
        <strong>What goes here:</strong> Pick a project type. The Tab 2
        asset entry surface uses this to filter the asset Type catalog
        and to print empty-state suggestions per phase. Asset detail
        (areas, sub-units, parking, pricing) lives in Tab 2 after
        create, not here.
      </div>

      <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)' }}>Project Type</h3>
      <div
        data-testid="wiz-project-type-options"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {PROJECT_TYPES.map((t) => (
          <label
            key={t}
            data-testid={`wiz-project-type-${t}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-1)',
              padding: 'var(--sp-2)',
              border: `1px solid ${draft.projectType === t ? 'var(--color-navy)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              background: draft.projectType === t ? 'var(--color-navy-pale)' : 'transparent',
              fontWeight: draft.projectType === t ? 700 : 500,
            }}
          >
            <input
              type="radio"
              name="wiz-project-type"
              value={t}
              checked={draft.projectType === t}
              onChange={() => onUpdate({ projectType: t as ProjectType })}
            />
            <span>{t}</span>
          </label>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div
          data-testid="wiz-project-type-suggestions"
          style={{
            background: 'var(--color-grey-pale)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-2)',
            fontSize: 'var(--font-small)',
            color: 'var(--color-meta)',
          }}
        >
          <strong>Tab 2 will suggest:</strong>{' '}
          {suggestions.join(', ')}
        </div>
      )}
    </div>
  );
}
