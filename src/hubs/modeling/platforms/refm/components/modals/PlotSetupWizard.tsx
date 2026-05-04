'use client';

/**
 * PlotSetupWizard — M1.10/6 modal-step UX for an existing Plot.
 *
 * Each REFM Plot carries 12+ inputs spanning four conceptual clusters:
 * Envelope (FAR + coverage), Floors (podium + typical + typicalCoverage),
 * Parking (3 bay sizes + basement count + efficiency), and Assets (which
 * AssetClass rows are physically built on this plot). The form view in
 * Module1AreaProgram exposes them as one wide grid which is efficient for
 * power users but hostile to first-time setup.
 *
 * This wizard walks the user through the four clusters one screen at a
 * time, mirroring the ProjectWizard pattern. The form view stays primary
 * — the wizard is opt-in via a "🪄 Setup wizard" button on each plot card.
 *
 * Architecture:
 *   - Owns a local `PlotDraft` (snapshot of the Plot's writable fields)
 *     plus a local `assignedAssetIds` Set. Both initialise from the store
 *     on mount; nothing leaks back to the store until the user clicks
 *     "Save & Close" on the final step. Cancel discards everything.
 *   - Reads the live `assets[]` from the store (read-only — the wizard
 *     can re-bind existing assets to this plot but never creates/deletes).
 *   - Layout matches ProjectWizard: 1080px max-width, sticky Back / Next
 *     footer, `wizard-step-N` testIds.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Plot } from '../../lib/state/module1-types';

// ── Plot draft type ──
// Same shape as Plot's writable numeric fields — nothing exotic. id /
// name / phaseId stay pinned (the wizard edits one specific plot).
interface PlotDraft {
  plotArea:              number;
  maxFAR:                number;
  coveragePct:           number;
  typicalCoveragePct:    number;
  numberOfFloors:        number;
  podiumFloors:          number;
  typicalFloors:         number;
  landscapePct:          number;
  hardscapePct:          number;
  surfaceBaySqm:         number;
  verticalBaySqm:        number;
  basementBaySqm:        number;
  basementCount:         number;
  basementEfficiencyPct: number;
}

function fromPlot(p: Plot): PlotDraft {
  return {
    plotArea:              p.plotArea,
    maxFAR:                p.maxFAR,
    coveragePct:           p.coveragePct,
    typicalCoveragePct:    p.typicalCoveragePct,
    numberOfFloors:        p.numberOfFloors,
    podiumFloors:          p.podiumFloors,
    typicalFloors:         p.typicalFloors,
    landscapePct:          p.landscapePct,
    hardscapePct:          p.hardscapePct,
    surfaceBaySqm:         p.surfaceBaySqm,
    verticalBaySqm:        p.verticalBaySqm,
    basementBaySqm:        p.basementBaySqm,
    basementCount:         p.basementCount,
    basementEfficiencyPct: p.basementEfficiencyPct,
  };
}

// ── Style tokens (FAST blue convention from M1.7+) ──
const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-semibold)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

interface Props {
  plotId:  string;
  onClose: () => void;
}

export default function PlotSetupWizard({ plotId, onClose }: Props): React.ReactElement | null {
  const plot       = useModule1Store(s => s.plots.find(p => p.id === plotId));
  const updatePlot = useModule1Store(s => s.updatePlot);
  const assets     = useModule1Store(s => s.assets);
  const updateAsset = useModule1Store(s => s.updateAsset);

  // Local draft + asset-assignment state. Hooks must run unconditionally
  // (rules of hooks); seed with a defensive zero-state when plot is
  // missing and bail to null after the hook block.
  const seed: PlotDraft = useMemo(
    () => plot ? fromPlot(plot) : {
      plotArea: 0, maxFAR: 0, coveragePct: 0, typicalCoveragePct: 0,
      numberOfFloors: 0, podiumFloors: 0, typicalFloors: 0,
      landscapePct: 0, hardscapePct: 0,
      surfaceBaySqm: 0, verticalBaySqm: 0, basementBaySqm: 0,
      basementCount: 0, basementEfficiencyPct: 0,
    },
    [plot],
  );
  const [draft, setDraft] = useState<PlotDraft>(seed);
  const [assignedAssetIds, setAssignedAssetIds] = useState<Set<string>>(
    () => new Set(assets.filter(a => a.plotId === plotId).map(a => a.id)),
  );
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Re-seed if the underlying plot id changes mid-mount (defensive — the
  // parent typically unmounts the modal between plots).
  useEffect(() => { setDraft(seed); }, [seed]);

  if (!plot) return null;

  // ── Live envelope preview ──
  // Shows utilisation percentage so the user can see whether their
  // current Floors choices stay inside the FAR ceiling. Mirrors the
  // formula in src/core/calculations/index.ts:705-720.
  const maxGFA           = draft.plotArea * draft.maxFAR;
  const footprint        = draft.plotArea * (draft.coveragePct / 100);
  const typicalFootprint = draft.plotArea * (draft.typicalCoveragePct / 100);
  const podiumGFA        = footprint * draft.podiumFloors;
  const typicalGFA       = typicalFootprint * draft.typicalFloors;
  const totalBuiltGFA    = podiumGFA + typicalGFA;
  const utilizationPct   = maxGFA > 0 ? (totalBuiltGFA / maxGFA) * 100 : 0;
  const isOverFAR        = utilizationPct > 100;

  // ── Field updaters ──
  const setNum = (key: keyof PlotDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setDraft(prev => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const toggleAssetAssignment = (assetId: string) => {
    setAssignedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });
  };

  // ── Save handler ──
  // On commit: write the full plot patch via updatePlot, then walk the
  // assigned-asset diff (assets newly checked get plotId=this; newly
  // unchecked get plotId='' which the rest of REFM treats as unassigned).
  const handleSave = () => {
    updatePlot(plotId, { ...plot, ...draft });
    const wasAssigned = new Set(assets.filter(a => a.plotId === plotId).map(a => a.id));
    for (const a of assets) {
      const nowAssigned = assignedAssetIds.has(a.id);
      const previously  = wasAssigned.has(a.id);
      if (nowAssigned && !previously) {
        updateAsset(a.id, { plotId });
      } else if (!nowAssigned && previously) {
        updateAsset(a.id, { plotId: '' });
      }
    }
    onClose();
  };

  // ── Step indicator ──
  const stepIndicator = (
    <div data-testid="plot-wizard-step-indicator" style={{
      display: 'flex', gap: 6, marginBottom: 'var(--sp-3)',
    }}>
      {[1, 2, 3, 4].map(n => (
        <div key={n} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: step >= n ? 'var(--color-primary)' : 'var(--color-border)',
        }} />
      ))}
    </div>
  );

  return (
    <div
      data-testid="plot-setup-wizard"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--sp-3)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 24px 48px rgba(0,0,0,0.25)',
        width: '100%', maxWidth: 800, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: 'var(--sp-3) var(--sp-4)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 'var(--font-h3)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>
              🪄 Plot Setup Wizard — {plot.name}
            </div>
            <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginTop: 2 }}>
              Step {step} of 4 · Walks through Envelope, Floors, Parking, Assets
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="plot-wizard-close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--color-meta)', padding: 4,
            }}
            aria-label="Close wizard"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--sp-4)', overflowY: 'auto', flex: 1 }}>
          {stepIndicator}

          {step === 1 && (
            <div data-testid="plot-wizard-step-1">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Envelope — what fits on the plot
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Plot Buildable Area is the physical footprint you build on. FAR is the regulatory ceiling on built GFA. Coverage is the share of the plot the podium can occupy.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-2)' }}>
                <div>
                  <label style={labelStyle}>Plot Buildable Area (sqm)</label>
                  <input data-testid="plot-wizard-plotArea" style={inputStyle} type="number" min={0} value={draft.plotArea} onChange={setNum('plotArea')} />
                </div>
                <div>
                  <label style={labelStyle}>Max FAR (ratio)</label>
                  <input data-testid="plot-wizard-maxFAR" style={inputStyle} type="number" min={0} step={0.1} value={draft.maxFAR} onChange={setNum('maxFAR')} />
                </div>
                <div>
                  <label style={labelStyle}>Podium Coverage (%)</label>
                  <input data-testid="plot-wizard-coveragePct" style={inputStyle} type="number" min={0} max={100} value={draft.coveragePct} onChange={setNum('coveragePct')} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div data-testid="plot-wizard-step-2">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Floors — how high it goes
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Podium floors share the podium coverage; typical floors share the typical (tower) coverage. Live utilisation below tells you whether the current choice stays inside the FAR ceiling.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-2)' }}>
                <div>
                  <label style={labelStyle}>Podium Floors (#)</label>
                  <input data-testid="plot-wizard-podiumFloors" style={inputStyle} type="number" min={0} value={draft.podiumFloors} onChange={setNum('podiumFloors')} />
                </div>
                <div>
                  <label style={labelStyle}>Typical Floors (#)</label>
                  <input data-testid="plot-wizard-typicalFloors" style={inputStyle} type="number" min={0} value={draft.typicalFloors} onChange={setNum('typicalFloors')} />
                </div>
                <div>
                  <label style={labelStyle}>Typical Coverage (%)</label>
                  <input data-testid="plot-wizard-typicalCoveragePct" style={inputStyle} type="number" min={0} max={100} value={draft.typicalCoveragePct} onChange={setNum('typicalCoveragePct')} />
                </div>
              </div>

              {/* Live envelope preview */}
              <div data-testid="plot-wizard-envelope-preview" style={{
                marginTop: 'var(--sp-3)',
                padding: 'var(--sp-2) var(--sp-3)',
                borderRadius: 'var(--radius-sm)',
                background: isOverFAR
                  ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                  : 'color-mix(in srgb, var(--color-success) 8%, transparent)',
                borderLeft: `3px solid ${isOverFAR ? 'var(--color-warning)' : 'var(--color-success)'}`,
                fontSize: 'var(--font-meta)',
                color: 'var(--color-body)',
                display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap',
              }}>
                <span><strong>Built GFA:</strong> {Math.round(totalBuiltGFA).toLocaleString()} sqm</span>
                <span style={{ color: 'var(--color-meta)' }}>·</span>
                <span><strong>Max GFA:</strong> {Math.round(maxGFA).toLocaleString()} sqm</span>
                <span style={{ color: 'var(--color-meta)' }}>·</span>
                <span style={{ fontWeight: 'var(--fw-bold)', color: isOverFAR ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  {isOverFAR ? '⚠' : '✓'} Utilisation {utilizationPct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div data-testid="plot-wizard-step-3">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Parking — bays and basements
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Bay area in sqm includes drive aisles + ramps. Basement count drives basement gross area; efficiency converts gross to usable.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
                <div>
                  <label style={labelStyle}>Surface Bay (sqm)</label>
                  <input data-testid="plot-wizard-surfaceBaySqm" style={inputStyle} type="number" min={0} value={draft.surfaceBaySqm} onChange={setNum('surfaceBaySqm')} />
                </div>
                <div>
                  <label style={labelStyle}>Vertical Bay (sqm)</label>
                  <input data-testid="plot-wizard-verticalBaySqm" style={inputStyle} type="number" min={0} value={draft.verticalBaySqm} onChange={setNum('verticalBaySqm')} />
                </div>
                <div>
                  <label style={labelStyle}>Basement Bay (sqm)</label>
                  <input data-testid="plot-wizard-basementBaySqm" style={inputStyle} type="number" min={0} value={draft.basementBaySqm} onChange={setNum('basementBaySqm')} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
                <div>
                  <label style={labelStyle}>Basement Count (#)</label>
                  <input data-testid="plot-wizard-basementCount" style={inputStyle} type="number" min={0} value={draft.basementCount} onChange={setNum('basementCount')} />
                </div>
                <div>
                  <label style={labelStyle}>Basement Efficiency (%)</label>
                  <input data-testid="plot-wizard-basementEfficiencyPct" style={inputStyle} type="number" min={0} max={100} value={draft.basementEfficiencyPct} onChange={setNum('basementEfficiencyPct')} />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div data-testid="plot-wizard-step-4">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Assets on this plot
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Pick which assets are physically built on this plot. Assets stay editable on the Asset & Sub-Unit detail editor below the plots list.
              </p>
              {assets.length === 0 ? (
                <p style={{ color: 'var(--color-meta)', fontStyle: 'italic' }}>
                  No assets exist yet. Create them via the wizard or the Asset detail editor, then re-open this wizard to assign them.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {assets.map(a => {
                    const checked = assignedAssetIds.has(a.id);
                    return (
                      <label
                        key={a.id}
                        data-testid={`plot-wizard-asset-row-${a.id}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px',
                          border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          borderRadius: 'var(--radius-sm)',
                          background: checked ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssetAssignment(a.id)}
                          data-testid={`plot-wizard-asset-toggle-${a.id}`}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)' }}>{a.name}</div>
                          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
                            {a.type} · {a.category} · {a.allocationPct}% allocation
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 'var(--sp-3) var(--sp-4)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)',
        }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="plot-wizard-cancel"
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)', background: 'var(--color-surface)',
              color: 'var(--color-body)', cursor: 'pointer', fontSize: 'var(--font-body)',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s > 1 ? (s - 1) as typeof step : s))}
                data-testid="plot-wizard-back"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                  color: 'var(--color-body)', cursor: 'pointer', fontSize: 'var(--font-body)',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                ← Back
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s < 4 ? (s + 1) as typeof step : s))}
                data-testid="plot-wizard-next"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: 'none', background: 'var(--color-primary)',
                  color: 'var(--color-on-primary-navy)', cursor: 'pointer', fontSize: 'var(--font-body)',
                  fontWeight: 'var(--fw-bold)', fontFamily: 'Inter, sans-serif',
                }}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                data-testid="plot-wizard-save"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: 'none', background: 'var(--color-success)',
                  color: 'var(--color-on-primary-navy)', cursor: 'pointer', fontSize: 'var(--font-body)',
                  fontWeight: 'var(--fw-bold)', fontFamily: 'Inter, sans-serif',
                }}
              >
                ✓ Save & Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
