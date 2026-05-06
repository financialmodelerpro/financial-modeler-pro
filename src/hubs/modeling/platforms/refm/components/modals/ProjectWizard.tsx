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
  type WizardDraftAsset,
  makeDefaultWizardDraft,
} from '../../lib/wizard/buildWizardSnapshot';
import {
  type AssetStrategy,
  type LandAllocationMode,
  type ModelGranularity,
  ASSET_STRATEGIES,
  ASSET_TYPES_BY_STRATEGY,
  LAND_ALLOCATION_MODES,
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
    draft.phases.every((p) => p.constructionPeriods > 0 && p.operationsPeriods >= 0) &&
    draft.parcels.every(
      (p) => p.area > 0 && p.rate > 0 && Math.abs(p.cashPct + p.inKindPct - 100) < 0.1,
    );
  const step3Valid = draft.assets.length > 0;

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
              {s === 3 && '3. Assets'}
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
          <label style={labelStyle} htmlFor="wiz-modelType">Model Granularity</label>
          <select
            id="wiz-modelType"
            data-testid="wiz-modelType"
            value={draft.modelType}
            onChange={(e) => onUpdate({ modelType: e.target.value as ModelGranularity })}
            style={inputStyle}
          >
            <option value="annual">Annual</option>
            <option value="monthly">Monthly</option>
          </select>
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
  // phase visually picks up where the prior one stopped.
  const computeNextPhaseStartDate = (): string => {
    const prior = draft.phases[draft.phases.length - 1];
    if (!prior || !prior.startDate) return draft.startDate;
    const d = new Date(prior.startDate);
    if (Number.isNaN(d.getTime())) return draft.startDate;
    if (draft.modelType === 'monthly') d.setMonth(d.getMonth() + Math.max(0, prior.constructionPeriods));
    else d.setFullYear(d.getFullYear() + Math.max(0, prior.constructionPeriods));
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

  // M2.0e: unit suffix tracks the project's modelType. "(years)" for
  // annual, "(months)" for monthly. Reactive so editing modelType in
  // Step 1 and returning to Step 2 reflects the change immediately.
  const periodUnit = draft.modelType === 'annual' ? 'years' : 'months';

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

function Step3({
  draft,
  onUpdate,
}: {
  draft: WizardDraft;
  onUpdate: (patch: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const update = (idx: number, patch: Partial<WizardDraftAsset>): void => {
    onUpdate({ assets: draft.assets.map((a, i) => (i === idx ? { ...a, ...patch } : a)) });
  };
  const add = (): void => {
    onUpdate({
      assets: [
        ...draft.assets,
        {
          name: `Asset ${draft.assets.length + 1}`,
          strategy: 'Sell',
          type: 'High-end Apartments',
          gfaSqm: 0,
          buaSqm: 0,
          sellableBuaSqm: 0,
          parkingBaysRequired: 0,
          subUnitName: 'Sub-unit',
          subUnitMetric: 'count',
          subUnitMetricValue: 50,
          subUnitUnitArea: 100,
          subUnitUnitPrice: 1000000,
        },
      ],
    });
  };
  const remove = (idx: number): void => {
    if (draft.assets.length <= 1) return;
    onUpdate({ assets: draft.assets.filter((_, i) => i !== idx) });
  };

  return (
    <div data-testid="wizard-step-3-content">
      {draft.assets.map((a, idx) => (
        <div
          key={idx}
          data-testid={`wiz-asset-row-${idx}`}
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-2)',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--sp-2)',
              marginBottom: 'var(--sp-2)',
            }}
          >
            <div>
              <label style={labelStyle}>Name</label>
              <input
                type="text"
                data-testid={`wiz-asset-${idx}-name`}
                value={a.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Strategy</label>
              <select
                data-testid={`wiz-asset-${idx}-strategy`}
                value={a.strategy}
                onChange={(e) => update(idx, { strategy: e.target.value as AssetStrategy, type: ASSET_TYPES_BY_STRATEGY[e.target.value as AssetStrategy][0] })}
                style={inputStyle}
              >
                {ASSET_STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <input
                type="text"
                list={`wiz-asset-types-${idx}`}
                data-testid={`wiz-asset-${idx}-type`}
                value={a.type}
                onChange={(e) => update(idx, { type: e.target.value })}
                style={inputStyle}
              />
              <datalist id={`wiz-asset-types-${idx}`}>
                {ASSET_TYPES_BY_STRATEGY[a.strategy].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              {draft.assets.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  data-testid={`wiz-asset-${idx}-remove`}
                  style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--sp-2)',
            }}
          >
            <div>
              <label style={labelStyle}>GFA (sqm)</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-gfaSqm`}
                value={a.gfaSqm}
                onChange={(e) => update(idx, { gfaSqm: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>BUA (sqm)</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-buaSqm`}
                value={a.buaSqm}
                onChange={(e) => update(idx, { buaSqm: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Sellable BUA (sqm)</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-sellableBuaSqm`}
                value={a.sellableBuaSqm}
                onChange={(e) => update(idx, { sellableBuaSqm: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Parking Bays</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-parkingBaysRequired`}
                value={a.parkingBaysRequired}
                onChange={(e) => update(idx, { parkingBaysRequired: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
          </div>
          <div
            style={{
              marginTop: 'var(--sp-2)',
              borderTop: '1px solid var(--color-border)',
              paddingTop: 'var(--sp-2)',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 'var(--sp-2)',
            }}
          >
            <div>
              <label style={labelStyle}>Sub-unit Name</label>
              <input
                type="text"
                data-testid={`wiz-asset-${idx}-subUnitName`}
                value={a.subUnitName}
                onChange={(e) => update(idx, { subUnitName: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Metric</label>
              <select
                data-testid={`wiz-asset-${idx}-subUnitMetric`}
                value={a.subUnitMetric}
                onChange={(e) => update(idx, { subUnitMetric: e.target.value as 'count' | 'area' })}
                style={inputStyle}
              >
                <option value="count">count</option>
                <option value="area">area</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Value</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-subUnitMetricValue`}
                value={a.subUnitMetricValue}
                onChange={(e) => update(idx, { subUnitMetricValue: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>sqm/unit</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-subUnitUnitArea`}
                value={a.subUnitUnitArea ?? 0}
                onChange={(e) => update(idx, { subUnitUnitArea: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
                disabled={a.subUnitMetric === 'area'}
              />
            </div>
            <div>
              <label style={labelStyle}>Unit Price</label>
              <input
                type="number"
                min={0}
                data-testid={`wiz-asset-${idx}-subUnitUnitPrice`}
                value={a.subUnitUnitPrice}
                onChange={(e) => update(idx, { subUnitUnitPrice: Math.max(0, Number(e.target.value) || 0) })}
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        data-testid="wiz-add-asset"
        style={{ padding: 'var(--sp-1) var(--sp-2)', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
      >
        + Add Asset
      </button>
    </div>
  );
}
