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

import React, { useEffect, useMemo, useState } from 'react';
import type { ModelType } from '@core/types/project.types';
import type { AssetCategory, AssetStrategy } from '../../lib/state/module1-types';
import { PREBUILT_ASSET_TYPES, DEFAULT_STRATEGY_BY_CATEGORY } from '../../lib/state/module1-types';
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

// ── Default asset matrix per project type (M1.8/4) ─────────────────────────
// Suggested seed assets per wizard project type. Each row mirrors a
// WizardDraftAsset minus the local id (assigned at seed time). Allocation
// % per row sums to 100 within each type. Custom returns []; the user
// adds rows manually.
//
// Source: brief table — Residential 100% high-end apartments, Hospitality
// 100% Hotel 5-star, Retail 100% Retail, Office 100% Office, Mixed-Use
// split 50/30/20 across residential/hotel/retail. Asset names + types
// match PREBUILT_ASSET_TYPES so the type dropdown lands on the right
// option without the user picking again.
type WizardDefaultAssetSeed = Omit<WizardDraftAsset, 'id'>;

export const WIZARD_DEFAULT_ASSETS_BY_TYPE: Record<WizardProjectType, WizardDefaultAssetSeed[]> = {
  Residential: [
    { name: 'Residential Tower', type: 'High-end Apartments', category: 'Sell', allocationPct: 100, strategy: 'Develop & Sell' },
  ],
  Hospitality: [
    { name: 'Hotel', type: 'Hotel 5-star', category: 'Operate', allocationPct: 100, strategy: 'Develop & Operate' },
  ],
  Retail: [
    { name: 'Retail Center', type: 'Retail', category: 'Lease', allocationPct: 100, strategy: 'Develop & Lease' },
  ],
  Office: [
    { name: 'Office Tower', type: 'Office', category: 'Lease', allocationPct: 100, strategy: 'Develop & Lease' },
  ],
  'Mixed-Use': [
    { name: 'Residential Tower', type: 'High-end Apartments', category: 'Sell',    allocationPct: 50, strategy: 'Develop & Sell' },
    { name: 'Hotel',             type: 'Hotel 5-star',        category: 'Operate', allocationPct: 30, strategy: 'Develop & Operate' },
    { name: 'Retail Podium',     type: 'Retail',              category: 'Lease',   allocationPct: 20, strategy: 'Develop & Lease' },
  ],
  Custom: [],
};

// Local id helper. The wizard never persists these — the build helper
// (M1.8/5) mints stable AssetClass ids when writing the snapshot.
let _wizardAssetIdCounter = 0;
function makeWizardAssetId(): string {
  _wizardAssetIdCounter += 1;
  return `wizard_asset_${Date.now()}_${_wizardAssetIdCounter}`;
}

export function seedAssetsForType(type: WizardProjectType): WizardDraftAsset[] {
  return WIZARD_DEFAULT_ASSETS_BY_TYPE[type].map(a => ({ ...a, id: makeWizardAssetId() }));
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
    // Pre-seed with the Mixed-Use defaults so Step 3 opens with a
    // populated list. The user can change the project type at any time
    // and the assets table re-seeds (see Step3Assets handleTypeChange).
    assets:              seedAssetsForType('Mixed-Use'),
  };
}

// ── Dirty detection (Esc / backdrop confirm) ───────────────────────────────
// "Has the user entered any data" reduces to "does the current draft
// differ from the seed default in any field that we'd be sad to lose?"
// Asset list is compared by signature (name/type/category/allocationPct)
// rather than by reference equality because the seed populates ids via
// makeWizardAssetId() at draft-creation time, and those ids will never
// match a re-seeded list even when the user hasn't actually changed
// anything.
function assetSignature(assets: WizardDraftAsset[]): string {
  return assets.map(a => `${a.name}:${a.type}:${a.category}:${a.allocationPct}:${a.strategy}`).join('|');
}

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
    d.wizardProjectType !== seed.wizardProjectType ||
    assetSignature(d.assets) !== assetSignature(seed.assets)
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
   * M1.8/5: receives the full wizard draft. RealEstatePlatform's
   * handleCreateProjectFromWizard turns this into a populated
   * HydrateSnapshot via buildWizardSnapshot(draft) and posts it to
   * the persistence layer, then routes to the Area Program tab.
   */
  onCreate: (draft: WizardDraft) => void;
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
  // Step 3 valid: at least 1 asset AND total allocation sums to exactly
  // 100%. Allow a tiny float tolerance (0.01) so the auto-balance helper
  // doesn't trap users with 33.33 + 33.33 + 33.34 = 100.00 rounding.
  const step3AllocSum = draft.assets.reduce((s, a) => s + (Number.isFinite(a.allocationPct) ? a.allocationPct : 0), 0);
  const step3Valid = draft.assets.length > 0 && Math.abs(step3AllocSum - 100) < 0.01;

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
      // Step 3 commit: hand the full draft to the parent's
      // transactional create handler (M1.8/5). The parent normalizes
      // the draft into a HydrateSnapshot via buildWizardSnapshot, then
      // posts to /api/refm/projects with the populated structure.
      onCreate({
        ...draft,
        name: draft.name.trim(),
        location: draft.location.trim(),
      });
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
        style={{ maxWidth: 1080, width: '100%' }}
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
            <Step3Assets draft={draft} setDraft={setDraft} allocSum={step3AllocSum} />
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

        {/* Model Type + Status row (paired so Step 1 fits one screen on
            standard 1080p displays — no scroll required). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
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

// ── Step 3: Assets (M1.8/4) ───────────────────────────────────────────────
// Project Type radio (Residential / Hospitality / Retail / Office /
// Mixed-Use / Custom) + an editable asset list. Changing the type re-
// seeds the asset list from WIZARD_DEFAULT_ASSETS_BY_TYPE — but only
// when the user hasn't manually customized it (otherwise we'd discard
// their work on an accidental click). We track this via the asset
// signature (length + name list).
//
// Each row exposes Name / Type / Category / Allocation % / Remove. The
// Type dropdown is built from PREBUILT_ASSET_TYPES bucketed by category,
// plus a "Custom" option that lets the user type a free-form name.
// Category is editable independently so users can override the default
// per-type bucket (e.g. set a Hotel asset to Operate or Hybrid).
//
// Allocation % is a free-form number input. The "Auto-balance" button
// distributes 100% evenly across all rows (rounded down with the
// remainder added to the first row so the total lands exactly on 100).
// Step3Valid in the parent gates on sum===100 so the user can't proceed
// with an invalid mix.
interface Step3Props {
  draft:    WizardDraft;
  setDraft: React.Dispatch<React.SetStateAction<WizardDraft>>;
  allocSum: number;
}

const PREBUILT_TYPE_FLAT: Array<{ category: AssetCategory; type: string }> = (() => {
  const out: Array<{ category: AssetCategory; type: string }> = [];
  for (const cat of ['Sell', 'Operate', 'Lease', 'Hybrid'] as const) {
    for (const t of PREBUILT_ASSET_TYPES[cat]) out.push({ category: cat, type: t });
  }
  return out;
})();

function Step3Assets({ draft, setDraft, allocSum }: Step3Props) {
  // Has the user customized the auto-seeded asset list? Compare the
  // current row signature to the seed for the active type. If it
  // matches, switching project type re-seeds the list automatically.
  // If the user has edited rows, switching type pops a confirm so we
  // don't silently throw away their work.
  const seedSignature = useMemo(() => {
    return WIZARD_DEFAULT_ASSETS_BY_TYPE[draft.wizardProjectType]
      .map(a => `${a.name}:${a.type}:${a.category}:${a.allocationPct}`).join('|');
  }, [draft.wizardProjectType]);
  const currentSignature = draft.assets
    .map(a => `${a.name}:${a.type}:${a.category}:${a.allocationPct}`).join('|');
  const isSeeded = seedSignature === currentSignature;

  function handleTypeChange(next: WizardProjectType) {
    if (next === draft.wizardProjectType) return;
    let assets = draft.assets;
    if (isSeeded || draft.assets.length === 0) {
      assets = seedAssetsForType(next);
    } else {
      const ok = window.confirm(
        `Replace the current asset list with the default mix for "${next}"?\n\nYour edits to the existing assets will be lost.`,
      );
      if (ok) assets = seedAssetsForType(next);
    }
    setDraft(prev => ({ ...prev, wizardProjectType: next, assets }));
  }

  function updateAsset(id: string, patch: Partial<WizardDraftAsset>) {
    setDraft(prev => ({
      ...prev,
      assets: prev.assets.map(a => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  function removeAsset(id: string) {
    setDraft(prev => ({
      ...prev,
      assets: prev.assets.filter(a => a.id !== id),
    }));
  }

  function addAsset() {
    const newRow: WizardDraftAsset = {
      id: makeWizardAssetId(),
      name: 'New Asset',
      type: 'High-end Apartments',
      category: 'Sell',
      allocationPct: 0,
      strategy: DEFAULT_STRATEGY_BY_CATEGORY['Sell'],
    };
    setDraft(prev => ({ ...prev, assets: [...prev.assets, newRow] }));
  }

  function autoBalance() {
    setDraft(prev => {
      const n = prev.assets.length;
      if (n === 0) return prev;
      const base = Math.floor(10000 / n) / 100;     // % with 2dp, rounded down
      const remainder = 100 - base * n;
      return {
        ...prev,
        assets: prev.assets.map((a, i) => ({
          ...a,
          allocationPct: i === 0 ? Math.round((base + remainder) * 100) / 100 : base,
        })),
      };
    });
  }

  // Type dropdown change: also flips category to the matching bucket
  // so the row stays internally consistent. If user picks Custom, leave
  // category alone (they may want Sell/Operate/Lease/Hybrid manually).
  function handleAssetTypeChange(id: string, type: string) {
    const found = PREBUILT_TYPE_FLAT.find(p => p.type === type);
    if (found) {
      updateAsset(id, {
        type,
        category: found.category,
        strategy: DEFAULT_STRATEGY_BY_CATEGORY[found.category],
      });
    } else {
      updateAsset(id, { type });
    }
  }

  function handleAssetCategoryChange(id: string, category: AssetCategory) {
    updateAsset(id, {
      category,
      strategy: DEFAULT_STRATEGY_BY_CATEGORY[category],
    });
  }

  const allocOk = Math.abs(allocSum - 100) < 0.01;
  const allocColor = allocOk ? 'var(--color-positive)' : 'var(--color-negative)';

  return (
    <div data-testid="wizard-step-3">
      <h3 style={{
        fontSize: 'var(--font-body)',
        fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-heading)',
        margin: '0 0 6px 0',
      }}>
        Step 3 — Assets
      </h3>
      <p style={{
        fontSize: 'var(--font-meta)',
        color: 'var(--color-meta)',
        margin: '0 0 var(--sp-3) 0',
      }}>
        Pick a project type — we&apos;ll suggest a starting set. Edit / add /
        remove assets as needed; allocation % across all rows must sum
        to 100.
      </p>

      {/* Project Type radio (3 across) */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <span style={labelTextStyle}>Project Type</span>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          marginTop: 6,
        }} role="radiogroup" aria-label="Project Type">
          {WIZARD_PROJECT_TYPES.map(t => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={draft.wizardProjectType === t}
              data-testid={`wizard-project-type-${t.toLowerCase().replace(/[^a-z]/g, '')}`}
              onClick={() => handleTypeChange(t)}
              style={{
                ...radioPillStyle(draft.wizardProjectType === t),
                textAlign: 'center',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Asset rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="wizard-assets-list">
        {draft.assets.length === 0 && (
          <div style={{
            padding: 'var(--sp-3)',
            textAlign: 'center',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-meta)',
            fontSize: 'var(--font-meta)',
          }}>
            No assets yet. Click <strong>+ Add Asset</strong> below to build your mix manually.
          </div>
        )}
        {draft.assets.map(a => (
          <div
            key={a.id}
            data-testid={`wizard-asset-row-${a.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 1fr) 80px 28px',
              gap: 6,
              alignItems: 'center',
              padding: '8px',
              background: 'color-mix(in srgb, var(--color-positive) 4%, var(--color-surface))',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <input
              type="text"
              value={a.name}
              onChange={e => updateAsset(a.id, { name: e.target.value })}
              placeholder="Asset name"
              data-testid="wizard-asset-name"
              style={wizardInputStyle}
            />
            <select
              value={a.type}
              onChange={e => handleAssetTypeChange(a.id, e.target.value)}
              data-testid="wizard-asset-type"
              style={wizardInputStyle}
            >
              {(['Sell', 'Operate', 'Lease', 'Hybrid'] as const).map(cat => (
                <optgroup key={cat} label={cat}>
                  {PREBUILT_ASSET_TYPES[cat].map(t => <option key={`${cat}/${t}`} value={t}>{t}</option>)}
                </optgroup>
              ))}
              {!PREBUILT_TYPE_FLAT.some(p => p.type === a.type) && (
                <option value={a.type}>{a.type} (custom)</option>
              )}
            </select>
            <select
              value={a.category}
              onChange={e => handleAssetCategoryChange(a.id, e.target.value as AssetCategory)}
              data-testid="wizard-asset-category"
              style={wizardInputStyle}
            >
              <option value="Sell">Sell</option>
              <option value="Operate">Operate</option>
              <option value="Lease">Lease</option>
              <option value="Hybrid">Hybrid</option>
            </select>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={a.allocationPct}
              onChange={e => {
                const v = parseFloat(e.target.value);
                updateAsset(a.id, { allocationPct: Number.isFinite(v) ? v : 0 });
              }}
              data-testid="wizard-asset-allocation"
              style={{ ...wizardInputStyle, textAlign: 'right' }}
            />
            <button
              type="button"
              onClick={() => removeAsset(a.id)}
              disabled={draft.assets.length <= 1}
              aria-label={`Remove ${a.name}`}
              title={draft.assets.length <= 1 ? 'Need at least one asset' : `Remove ${a.name}`}
              data-testid="wizard-asset-remove"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: draft.assets.length <= 1 ? 'not-allowed' : 'pointer',
                opacity: draft.assets.length <= 1 ? 0.3 : 1,
                color: 'var(--color-negative)',
                fontSize: 14,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add + Auto-balance + Total */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--sp-2)',
        marginTop: 'var(--sp-2)',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={addAsset}
            data-testid="wizard-asset-add"
            className="btn-secondary"
            style={{ fontSize: 'var(--font-meta)', padding: '6px 12px' }}
          >
            + Add Asset
          </button>
          <button
            type="button"
            onClick={autoBalance}
            disabled={draft.assets.length === 0}
            data-testid="wizard-asset-autobalance"
            className="btn-secondary"
            style={{ fontSize: 'var(--font-meta)', padding: '6px 12px' }}
          >
            ⚖ Auto-balance
          </button>
        </div>
        <div
          data-testid="wizard-asset-total"
          style={{
            fontSize: 'var(--font-meta)',
            fontWeight: 'var(--fw-semibold)',
            color: allocColor,
          }}
        >
          Total: {allocSum.toFixed(2)}% {allocOk ? '✓' : '(must = 100)'}
        </div>
      </div>
    </div>
  );
}
