'use client';

/**
 * ParcelSetupWizard — M1.10/7 modal-step UX for Land Parcels.
 *
 * Land Parcels are the financial side of the Land tab — what the project
 * owns + how it paid for it (cash + in-kind split). The form view is fine
 * for power users; first-time setup benefits from a guided walk that
 * collects the parcels one at a time and lets users add another or
 * commit when done.
 *
 * Architecture:
 *   - Owns a local LandParcel[] draft. Nothing leaks back to the store
 *     until the user clicks "Save & Close" on the review step.
 *   - Two screens: (1) build the parcel list with "Add another parcel"
 *     pattern, (2) review the list + commit.
 *   - The form view stays primary on the Land tab; this wizard is opt-in
 *     via a "🪄 Setup parcels" button.
 */

import React, { useState } from 'react';
import { useModule1Store } from '../../lib/state/module1-store';
import type { LandParcel } from '@core/types/project.types';

interface DraftParcel {
  name:       string;
  area:       number;
  rate:       number;
  cashPct:    number;
  inKindPct:  number;
}

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
  onClose: () => void;
}

export default function ParcelSetupWizard({ onClose }: Props): React.ReactElement {
  const setLand = useModule1Store(s => s.setLand);
  const existingParcels = useModule1Store(s => s.landParcels);

  // Seed the wizard with whatever the user has now. Common case: 1 default
  // parcel from DEFAULT_MODULE1_STATE. Lets the user adjust the seed
  // rather than start from scratch.
  const [drafts, setDrafts] = useState<DraftParcel[]>(
    () => existingParcels.length > 0
      ? existingParcels.map(p => ({
          name: p.name, area: p.area, rate: p.rate,
          cashPct: p.cashPct, inKindPct: p.inKindPct,
        }))
      : [{ name: 'Parcel 1', area: 0, rate: 0, cashPct: 60, inKindPct: 40 }],
  );
  const [step, setStep] = useState<1 | 2>(1);

  const updateDraft = (idx: number, patch: Partial<DraftParcel>) => {
    setDrafts(prev => prev.map((d, i) => {
      if (i !== idx) return d;
      const next = { ...d, ...patch };
      if (patch.cashPct !== undefined)   next.inKindPct = 100 - patch.cashPct;
      if (patch.inKindPct !== undefined) next.cashPct   = 100 - patch.inKindPct;
      return next;
    }));
  };

  const addParcel = () => {
    setDrafts(prev => [
      ...prev,
      { name: `Parcel ${prev.length + 1}`, area: 0, rate: 0, cashPct: 60, inKindPct: 40 },
    ]);
  };

  const removeParcel = (idx: number) => {
    if (drafts.length <= 1) return;
    setDrafts(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const next: LandParcel[] = drafts.map((d, i) => ({
      id:        i + 1,
      name:      d.name.trim() || `Parcel ${i + 1}`,
      area:      Number(d.area)      || 0,
      rate:      Number(d.rate)      || 0,
      cashPct:   Number(d.cashPct)   || 0,
      inKindPct: Number(d.inKindPct) || 0,
    }));
    setLand({ landParcels: next });
    onClose();
  };

  const totalArea  = drafts.reduce((s, d) => s + (Number(d.area)            || 0), 0);
  const totalValue = drafts.reduce((s, d) => s + (Number(d.area) * Number(d.rate) || 0), 0);

  const stepIndicator = (
    <div data-testid="parcel-wizard-step-indicator" style={{
      display: 'flex', gap: 6, marginBottom: 'var(--sp-3)',
    }}>
      {[1, 2].map(n => (
        <div key={n} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: step >= n ? 'var(--color-primary)' : 'var(--color-border)',
        }} />
      ))}
    </div>
  );

  return (
    <div
      data-testid="parcel-setup-wizard"
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
        width: '100%', maxWidth: 720, maxHeight: '90vh',
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
              🪄 Land Parcel Setup Wizard
            </div>
            <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginTop: 2 }}>
              Step {step} of 2 · Build your parcel list, review, then commit
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="parcel-wizard-close"
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
            <div data-testid="parcel-wizard-step-1">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Add the parcels you own (or contributing in-kind)
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Each parcel: a name, area, rate per sqm, and cash / in-kind split. Use this for parcels you&apos;re acquiring or contributing — physical plot envelopes (FAR, coverage, floors) live on Build Program.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {drafts.map((d, idx) => (
                  <div
                    key={idx}
                    data-testid={`parcel-wizard-draft-${idx}`}
                    style={{
                      padding: 'var(--sp-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                      <strong style={{ color: 'var(--color-heading)' }}>Parcel {idx + 1}</strong>
                      {drafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeParcel(idx)}
                          data-testid={`parcel-wizard-remove-${idx}`}
                          style={{
                            marginLeft: 'auto', padding: '2px 8px', fontSize: 11,
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--color-surface)',
                            color: 'var(--color-meta)', cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 'var(--sp-2)' }}>
                      <div>
                        <label style={labelStyle}>Name</label>
                        <input data-testid={`parcel-wizard-name-${idx}`} style={inputStyle} type="text" value={d.name} onChange={e => updateDraft(idx, { name: e.target.value })} />
                      </div>
                      <div>
                        <label style={labelStyle}>Area (sqm)</label>
                        <input data-testid={`parcel-wizard-area-${idx}`} style={inputStyle} type="number" min={0} value={d.area} onChange={e => updateDraft(idx, { area: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label style={labelStyle}>Rate (/sqm)</label>
                        <input data-testid={`parcel-wizard-rate-${idx}`} style={inputStyle} type="number" min={0} value={d.rate} onChange={e => updateDraft(idx, { rate: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label style={labelStyle}>Cash %</label>
                        <input data-testid={`parcel-wizard-cashPct-${idx}`} style={inputStyle} type="number" min={0} max={100} value={d.cashPct} onChange={e => updateDraft(idx, { cashPct: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label style={labelStyle}>In-Kind %</label>
                        <input data-testid={`parcel-wizard-inKindPct-${idx}`} style={inputStyle} type="number" min={0} max={100} value={d.inKindPct} onChange={e => updateDraft(idx, { inKindPct: Number(e.target.value) })} />
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addParcel}
                  data-testid="parcel-wizard-add-another"
                  style={{
                    padding: '8px 12px',
                    border: '1px dashed var(--color-primary)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    color: 'var(--color-primary)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-body)',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  + Add another parcel
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div data-testid="parcel-wizard-step-2">
              <h3 style={{ margin: 0, marginBottom: 6, fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)' }}>
                Review &amp; commit
              </h3>
              <p style={{ margin: 0, marginBottom: 'var(--sp-3)', color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>
                Saving overwrites the current Land Parcels list. You can edit individual rows directly on the Land tab afterwards.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Name</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Area</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Rate</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Value</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Cash %</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>In-Kind %</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, idx) => {
                    const value = Number(d.area) * Number(d.rate);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '6px 4px', color: 'var(--color-heading)', fontWeight: 'var(--fw-semibold)' }}>{d.name}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{Math.round(d.area).toLocaleString()}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{Math.round(d.rate).toLocaleString()}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{Math.round(value).toLocaleString()}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{d.cashPct.toFixed(1)}%</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{d.inKindPct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>TOTAL</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>{Math.round(totalArea).toLocaleString()} sqm</td>
                    <td style={{ padding: '6px 4px' }} />
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>{Math.round(totalValue).toLocaleString()}</td>
                    <td style={{ padding: '6px 4px' }} />
                    <td style={{ padding: '6px 4px' }} />
                  </tr>
                </tfoot>
              </table>
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
            data-testid="parcel-wizard-cancel"
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
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                data-testid="parcel-wizard-back"
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
            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                data-testid="parcel-wizard-next"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: 'none', background: 'var(--color-primary)',
                  color: 'var(--color-on-primary-navy)', cursor: 'pointer', fontSize: 'var(--font-body)',
                  fontWeight: 'var(--fw-bold)', fontFamily: 'Inter, sans-serif',
                }}
              >
                Review →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                data-testid="parcel-wizard-save"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: 'none', background: 'var(--color-success)',
                  color: 'var(--color-on-primary-navy)', cursor: 'pointer', fontSize: 'var(--font-body)',
                  fontWeight: 'var(--fw-bold)', fontFamily: 'Inter, sans-serif',
                }}
              >
                ✓ Save &amp; Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
