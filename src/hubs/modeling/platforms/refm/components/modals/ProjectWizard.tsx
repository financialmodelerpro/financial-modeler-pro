'use client';

/**
 * ProjectWizard.tsx
 *
 * Phase M1.8 — Smart Project Creation Wizard.
 *
 * Replaces the legacy "+ New Project" → ProjectModal flow (which dropped
 * the user into an empty Hierarchy tab) with a guided 3-step wizard that
 * asks 3-5 simple questions and pre-creates the project structure. The
 * user lands in a populated workspace (Area Program tab) instead of a
 * 5-layer empty tree.
 *
 * Step machine:
 *   1. Project Basics         — name, location, currency, model type,
 *                                start date, status
 *   2. Project Structure      — Master Holding toggle, phase count,
 *                                plot count
 *   3. Assets                 — project type radio + editable asset list
 *                                with auto-balanced allocation %
 *
 * Lifecycle:
 *   - All draft state is held locally in this component; nothing writes
 *     to the Zustand store or the persistence client until the user
 *     clicks "Create Project" on Step 3.
 *   - Esc / backdrop click prompts a confirm if any data has been
 *     entered (any field deviates from the seed default), otherwise
 *     closes silently.
 *   - Tab navigates between fields; Enter on the final step's last
 *     field activates Create Project.
 *   - Back / Continue preserve all entered data; the user can move
 *     freely between steps until they commit.
 *
 * Commit 1 (this commit) ships the scaffold + state machine + draft
 * shape. Step bodies are placeholder cards that explain what each step
 * will ask for; the actual fields land in commits M1.8/2-4. Clicking
 * Create Project on the placeholder Step 3 falls back to the legacy
 * onCreate(name, location) handler so the wizard remains functional
 * end-to-end during the staged build.
 */

import React, { useEffect, useState } from 'react';
import type { ModelType } from '@core/types/project.types';
import type { AssetCategory, AssetStrategy } from '../../lib/state/module1-types';
import { COUNTRY_DATA } from '../RealEstatePlatform';

// ── Wizard project type (display-level enum) ───────────────────────────────
// Independent of the store's ProjectType ('residential' | 'hospitality' |
// 'mixed-use'). The wizard exposes this richer enum to the user so the
// Step 3 default-asset matrix can suggest something sensible per
// vertical; the build helper (commit M1.8/5) collapses it back to the
// legacy ProjectType when writing to the snapshot.
export const WIZARD_PROJECT_TYPES = ['Residential', 'Hospitality', 'Retail', 'Office', 'Mixed-Use', 'Custom'] as const;
export type WizardProjectType = typeof WIZARD_PROJECT_TYPES[number];

// ── Wizard asset row (Step 3) ──────────────────────────────────────────────
// `id` is a local uuid used as the React key while the row is in the
// wizard. The build helper assigns the persisted AssetClass id when the
// snapshot is constructed. `strategy` drives the placeholder sub-unit's
// metric (Sell/Operate → count, Lease → area).
export interface WizardDraftAsset {
  id:            string;
  name:          string;
  type:          string;
  category:      AssetCategory;
  allocationPct: number;
  strategy:      AssetStrategy;
}

// ── Full wizard draft ──────────────────────────────────────────────────────
// Single source of truth for everything the user has entered so far.
// Held in this component's local useState; never leaks to the store
// until commit on Step 3.
export interface WizardDraft {
  // Step 1
  name:        string;
  location:    string;
  currency:    string;
  modelType:   ModelType;
  startDate:   string;       // YYYY-MM-DD
  status:      'Draft' | 'Active';

  // Step 2
  enableMasterHolding: boolean;
  phaseCount:          number;   // 1..10
  plotCount:           number;   // 1..20

  // Step 3
  wizardProjectType: WizardProjectType;
  assets:            WizardDraftAsset[];
}

// ── Defaults ───────────────────────────────────────────────────────────────
// Step 1 default startDate = today + 6 months (clamped to YYYY-MM-DD).
// Currency default SAR matches DEFAULT_MODULE1_STATE so wizard projects
// align with the rest of the platform.
function todayPlus6MonthsIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

export function makeWizardDefaultDraft(): WizardDraft {
  return {
    name:                '',
    location:            '',
    currency:            'SAR',
    modelType:           'annual',
    startDate:           todayPlus6MonthsIso(),
    status:              'Draft',
    enableMasterHolding: false,
    phaseCount:          1,
    plotCount:           1,
    wizardProjectType:   'Mixed-Use',
    assets:              [],   // populated by Step 3 from the project-type matrix
  };
}

// ── Dirty detection (Esc / backdrop confirm) ───────────────────────────────
// "Has the user entered any data" reduces to "does the current draft
// differ from the seed default in any field that we'd be sad to lose?"
// Asset list is excluded from this check because Step 3 seeds it from
// the project-type matrix automatically — a freshly-opened wizard with
// the default Mixed-Use type has 3 assets but the user hasn't edited
// them.
function isDraftDirty(d: WizardDraft, seed: WizardDraft): boolean {
  return (
    d.name !== seed.name ||
    d.location !== seed.location ||
    d.currency !== seed.currency ||
    d.modelType !== seed.modelType ||
    d.startDate !== seed.startDate ||
    d.status !== seed.status ||
    d.enableMasterHolding !== seed.enableMasterHolding ||
    d.phaseCount !== seed.phaseCount ||
    d.plotCount !== seed.plotCount ||
    d.wizardProjectType !== seed.wizardProjectType
  );
}

// ── Visual tokens (FAST blue convention; mirrors REFM input style) ─────────
export const wizardInputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-semibold)',
};

const stepIndicatorPill = (active: boolean, done: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: active
    ? 'var(--color-primary)'
    : done
    ? 'color-mix(in srgb, var(--color-primary) 35%, transparent)'
    : 'color-mix(in srgb, var(--color-on-primary-navy) 12%, transparent)',
  color: active ? 'var(--color-on-primary-navy)' : done ? 'var(--color-on-primary-navy)' : 'color-mix(in srgb, var(--color-on-primary-navy) 60%, transparent)',
  fontSize: 12,
  fontWeight: 700,
});

const stepLabelStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: active ? 700 : 500,
  color: active
    ? 'var(--color-on-primary-navy)'
    : 'color-mix(in srgb, var(--color-on-primary-navy) 60%, transparent)',
  marginLeft: 6,
});

// ── Component props ───────────────────────────────────────────────────────
export interface ProjectWizardProps {
  /**
   * Legacy fallback used by Commit 1 until the transactional create
   * handler (M1.8/5) replaces it. Receives the final name + location
   * pair the wizard collected; matches the existing handleCreateProject
   * signature so RealEstatePlatform can wire the wizard in without
   * other plumbing changes.
   */
  onCreate: (name: string, location: string) => void;
  /**
   * Close handler. The wizard itself decides whether to prompt the
   * user before calling this (dirty-confirm rule).
   */
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────
export default function ProjectWizard({ onCreate, onClose }: ProjectWizardProps) {
  const [seed] = useState<WizardDraft>(() => makeWizardDefaultDraft());
  const [draft, setDraft] = useState<WizardDraft>(seed);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Esc key handler (with dirty confirm) ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        attemptClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // attemptClose closes over draft+seed via the latest render, but is
    // stable in shape; we re-bind on every state change so the latest
    // dirty check is in scope without a useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, seed]);

  function attemptClose(): void {
    if (isDraftDirty(draft, seed)) {
      const ok = window.confirm('Discard your wizard progress?\n\nThe values you entered will be lost.');
      if (!ok) return;
    }
    onClose();
  }

  // ── Step machine ──
  // Step 1 valid: name + location both filled.
  // Steps 2/3 will tighten validation in their respective commits.
  const step1Valid = draft.name.trim().length > 0 && draft.location.trim().length > 0;
  const step2Valid = draft.phaseCount >= 1 && draft.phaseCount <= 10
    && draft.plotCount >= 1 && draft.plotCount <= 20;
  const step3Valid = true;   // M1.8/4 will gate on assets sum=100

  const continueEnabled =
    step === 1 ? step1Valid :
    step === 2 ? step2Valid :
    step === 3 ? step3Valid :
    false;

  function handleContinue(): void {
    if (!continueEnabled) return;
    if (step < 3) {
      setStep(((step + 1) as 1 | 2 | 3));
    } else {
      // Step 3: commit. M1.8/5 replaces this with the transactional
      // wizard-snapshot create. Until then we hand off the basics to
      // the legacy onCreate handler so the wizard is end-to-end
      // functional throughout the staged build.
      onCreate(draft.name.trim(), draft.location.trim());
    }
  }

  function handleBack(): void {
    if (step > 1) setStep(((step - 1) as 1 | 2 | 3));
  }

  return (
    <div className="pm-modal-overlay" onClick={attemptClose} role="presentation">
      <div
        className="pm-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-wizard-title"
        style={{ maxWidth: 640, width: '100%' }}
      >
        {/* Header */}
        <div className="pm-modal-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div id="project-wizard-title" style={{ fontSize: '15px', fontWeight: 700 }}>
                🏗️ Create New Project
              </div>
              <div style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)', marginTop: '2px' }}>
                Answer 3 quick questions to land in a workspace that&apos;s already set up.
              </div>
            </div>
            <button
              onClick={attemptClose}
              aria-label="Close wizard"
              style={{
                background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)',
                border: 'none', borderRadius: '6px',
                width: '28px', height: '28px', cursor: 'pointer',
                color: 'var(--color-on-primary-navy)', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>

          {/* Step indicator: 3 pills + connector lines */}
          <div
            data-testid="wizard-step-indicator"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {[1, 2, 3].map((n, idx) => (
              <React.Fragment key={n}>
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span style={stepIndicatorPill(step === n, step > n)}>
                    {step > n ? '✓' : n}
                  </span>
                  <span style={stepLabelStyle(step === n)}>
                    {n === 1 ? 'Basics' : n === 2 ? 'Structure' : 'Assets'}
                  </span>
                </div>
                {idx < 2 && (
                  <span style={{
                    flex: 1,
                    height: 1,
                    background: 'color-mix(in srgb, var(--color-on-primary-navy) 18%, transparent)',
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body — placeholder content per step until M1.8/2-4 fill them in */}
        <div className="pm-modal-body" style={{ minHeight: 280 }}>
          {step === 1 && (
            <Step1Basics draft={draft} setDraft={setDraft} />
          )}
          {step === 2 && (
            <Step2Structure draft={draft} setDraft={setDraft} />
          )}
          {step === 3 && (
            <PlaceholderStep
              testId="wizard-step-3"
              heading="Step 3 — Assets"
              body="Project type and editable asset list with allocation %."
            />
          )}
        </div>

        {/* Footer: Back / Continue or Create Project */}
        <div className="pm-modal-footer" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn-secondary"
            onClick={step === 1 ? attemptClose : handleBack}
            data-testid="wizard-back"
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          <button
            className="btn-primary"
            onClick={handleContinue}
            disabled={!continueEnabled}
            data-testid={step === 3 ? 'wizard-create' : 'wizard-continue'}
          >
            {step === 3 ? '+ Create Project' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step body shared label cell ───────────────────────────────────────────
const labelTextStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const radioGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

function radioPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    border: `1px solid ${active ? 'var(--color-navy)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-meta)',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 'var(--fw-semibold)',
    background: active ? 'var(--color-navy-pale)' : 'var(--color-surface)',
    color: active ? 'var(--color-navy)' : 'var(--color-body)',
    cursor: 'pointer',
  };
}

// ── Step 1: Project Basics (M1.8/2) ───────────────────────────────────────
// Six fields. Name + Location required (Continue gating in the parent).
// Currency dropdown lifts COUNTRY_DATA so the wizard offers the same set
// the rest of REFM uses; the option label combines the country flag +
// currency code so users can scan visually.
interface Step1Props {
  draft:    WizardDraft;
  setDraft: React.Dispatch<React.SetStateAction<WizardDraft>>;
}

function Step1Basics({ draft, setDraft }: Step1Props) {
  return (
    <div data-testid="wizard-step-1">
      <h3 style={{
        fontSize: 'var(--font-body)',
        fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-heading)',
        margin: '0 0 6px 0',
      }}>
        Step 1 — Project Basics
      </h3>
      <p style={{
        fontSize: 'var(--font-meta)',
        color: 'var(--color-meta)',
        margin: '0 0 var(--sp-3) 0',
      }}>
        Tell us about the project so we can set up your workspace.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        {/* Name */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelTextStyle}>Project Name *</span>
          <input
            autoFocus
            type="text"
            value={draft.name}
            onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Skyline Towers, Marina Residences..."
            data-testid="wizard-name"
            style={wizardInputStyle}
          />
        </label>

        {/* Location */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelTextStyle}>Location *</span>
          <input
            type="text"
            value={draft.location}
            onChange={e => setDraft(prev => ({ ...prev, location: e.target.value }))}
            placeholder="e.g. Riyadh, Saudi Arabia"
            data-testid="wizard-location"
            style={wizardInputStyle}
          />
        </label>

        {/* Currency + Start Date row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelTextStyle}>Currency</span>
            <select
              value={draft.currency}
              onChange={e => setDraft(prev => ({ ...prev, currency: e.target.value }))}
              data-testid="wizard-currency"
              style={wizardInputStyle}
            >
              {COUNTRY_DATA.map(c => (
                <option key={c.currency} value={c.currency}>
                  {c.flag} {c.currency} — {c.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelTextStyle}>Project Start Date</span>
            <input
              type="date"
              value={draft.startDate}
              onChange={e => setDraft(prev => ({ ...prev, startDate: e.target.value }))}
              data-testid="wizard-start-date"
              style={wizardInputStyle}
            />
          </label>
        </div>

        {/* Model Type radio */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelTextStyle}>Model Type</span>
          <div style={radioGroupStyle} role="radiogroup" aria-label="Model Type">
            {(['annual', 'monthly'] as const).map(m => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={draft.modelType === m}
                onClick={() => setDraft(prev => ({ ...prev, modelType: m }))}
                data-testid={`wizard-model-type-${m}`}
                style={radioPillStyle(draft.modelType === m)}
              >
                {m === 'annual' ? 'Annual' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        {/* Status radio */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelTextStyle}>Status</span>
          <div style={radioGroupStyle} role="radiogroup" aria-label="Status">
            {(['Draft', 'Active'] as const).map(s => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={draft.status === s}
                onClick={() => setDraft(prev => ({ ...prev, status: s }))}
                data-testid={`wizard-status-${s.toLowerCase()}`}
                style={radioPillStyle(draft.status === s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Project Structure (M1.8/3) ────────────────────────────────────
// Three questions with smart defaults:
//   1. Is this part of a fund/portfolio? → Master Holding toggle
//   2. How many phases? → Single (1) or Multiple (2-10)
//   3. How many plots?  → Single (1) or Multiple (2-20)
//
// "Single" is the default for both phase + plot — the brief calls out
// that 90% of users (single phase, single plot, 2-3 assets) shouldn't
// see multi-phase / multi-plot complexity unless they opt in. The
// conditional 2-10 / 2-20 numeric input only appears when the user
// flips to Multiple.
//
// Ratification: progressive disclosure pattern from M1.5/M1.7. Selecting
// Multiple expands an inline numeric input; selecting Single collapses
// the count back to 1 so the wizard doesn't carry a dangling 5-phase
// intent if the user changed their mind.
interface Step2Props {
  draft:    WizardDraft;
  setDraft: React.Dispatch<React.SetStateAction<WizardDraft>>;
}

function Step2Structure({ draft, setDraft }: Step2Props) {
  return (
    <div data-testid="wizard-step-2">
      <h3 style={{
        fontSize: 'var(--font-body)',
        fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-heading)',
        margin: '0 0 6px 0',
      }}>
        Step 2 — Project Structure
      </h3>
      <p style={{
        fontSize: 'var(--font-meta)',
        color: 'var(--color-meta)',
        margin: '0 0 var(--sp-3) 0',
      }}>
        These choices control which layers show up in the Hierarchy tab.
        Defaults work for most projects — you can always enable more
        layers later from the Hierarchy tab.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {/* Q1: Master Holding toggle */}
        <div>
          <span style={labelTextStyle}>Is this part of a fund or portfolio?</span>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 6,
            padding: '10px 12px',
            background: 'color-mix(in srgb, var(--color-primary) 4%, var(--color-surface))',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enableMasterHolding}
              data-testid="wizard-mh-toggle"
              onClick={() => setDraft(prev => ({ ...prev, enableMasterHolding: !prev.enableMasterHolding }))}
              style={{
                position: 'relative',
                width: 40,
                height: 22,
                borderRadius: 11,
                border: 'none',
                cursor: 'pointer',
                background: draft.enableMasterHolding ? 'var(--color-primary)' : 'var(--color-input-border)',
                transition: 'background 0.15s ease',
                padding: 0,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: draft.enableMasterHolding ? 20 : 2,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'var(--color-surface)',
                transition: 'left 0.15s ease',
              }} />
            </button>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 'var(--font-body)',
                fontWeight: 'var(--fw-semibold)',
                color: 'var(--color-heading)',
              }}>
                {draft.enableMasterHolding ? 'Yes — show Master Holding layer' : 'No — single project'}
              </div>
              <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginTop: 2 }}>
                Enables the Master Holding layer in the Hierarchy tab. Skip
                if this is a standalone project — you can convert later.
              </div>
            </div>
          </div>
        </div>

        {/* Q2: Phases */}
        <div>
          <span style={labelTextStyle}>How many phases?</span>
          <div style={{ ...radioGroupStyle, marginTop: 6 }} role="radiogroup" aria-label="Phase count">
            <button
              type="button"
              role="radio"
              aria-checked={draft.phaseCount === 1}
              data-testid="wizard-phases-single"
              onClick={() => setDraft(prev => ({ ...prev, phaseCount: 1 }))}
              style={radioPillStyle(draft.phaseCount === 1)}
            >
              Single Phase (most projects)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.phaseCount > 1}
              data-testid="wizard-phases-multiple"
              onClick={() => setDraft(prev => ({ ...prev, phaseCount: prev.phaseCount > 1 ? prev.phaseCount : 2 }))}
              style={radioPillStyle(draft.phaseCount > 1)}
            >
              Multiple Phases (staged development)
            </button>
          </div>
          {draft.phaseCount > 1 && (
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 8,
                fontSize: 'var(--font-meta)', color: 'var(--color-meta)',
              }}
            >
              <span>How many?</span>
              <input
                type="number"
                min={2}
                max={10}
                value={draft.phaseCount}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isNaN(v)) return;
                  setDraft(prev => ({ ...prev, phaseCount: Math.min(10, Math.max(2, v)) }));
                }}
                data-testid="wizard-phase-count"
                style={{ ...wizardInputStyle, width: 80 }}
              />
              <span>(2–10)</span>
            </label>
          )}
        </div>

        {/* Q3: Plots */}
        <div>
          <span style={labelTextStyle}>How many plots?</span>
          <div style={{ ...radioGroupStyle, marginTop: 6 }} role="radiogroup" aria-label="Plot count">
            <button
              type="button"
              role="radio"
              aria-checked={draft.plotCount === 1}
              data-testid="wizard-plots-single"
              onClick={() => setDraft(prev => ({ ...prev, plotCount: 1 }))}
              style={radioPillStyle(draft.plotCount === 1)}
            >
              Single Plot
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.plotCount > 1}
              data-testid="wizard-plots-multiple"
              onClick={() => setDraft(prev => ({ ...prev, plotCount: prev.plotCount > 1 ? prev.plotCount : 2 }))}
              style={radioPillStyle(draft.plotCount > 1)}
            >
              Multiple Plots (large land bank)
            </button>
          </div>
          {draft.plotCount > 1 && (
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 8,
                fontSize: 'var(--font-meta)', color: 'var(--color-meta)',
              }}
            >
              <span>How many?</span>
              <input
                type="number"
                min={2}
                max={20}
                value={draft.plotCount}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isNaN(v)) return;
                  setDraft(prev => ({ ...prev, plotCount: Math.min(20, Math.max(2, v)) }));
                }}
                data-testid="wizard-plot-count"
                style={{ ...wizardInputStyle, width: 80 }}
              />
              <span>(2–20)</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Placeholder step body (M1.8/3) ────────────────────────────────────────
// Step 3 still placeholder until M1.8/4 lands.
interface PlaceholderStepProps {
  testId:  string;
  heading: string;
  body:    string;
}

function PlaceholderStep({ testId, heading, body }: PlaceholderStepProps) {
  return (
    <div data-testid={testId}>
      <h3 style={{
        fontSize: 'var(--font-body)',
        fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-heading)',
        margin: '0 0 6px 0',
      }}>
        {heading}
      </h3>
      <p style={{
        fontSize: 'var(--font-meta)',
        color: 'var(--color-meta)',
        margin: '0 0 var(--sp-3) 0',
      }}>
        {body}
      </p>
    </div>
  );
}
