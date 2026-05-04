'use client';

import React from 'react';
import type { LandParcel, ProjectType } from '@/src/core/types/project.types';
import { formatNumber, formatCurrency } from '@/src/core/formatters';

interface Module1AreaProps {
  landParcels: LandParcel[]; setLandParcels: (v: LandParcel[]) => void;
  projectRoadsPct: number; setProjectRoadsPct: (v: number) => void;
  projectFAR: number; setProjectFAR: (v: number) => void;
  projectNonEnclosedPct: number; setProjectNonEnclosedPct: (v: number) => void;
  residentialPercent: number; setResidentialPercent: (v: number) => void;
  hospitalityPercent: number; setHospitalityPercent: (v: number) => void;
  retailPercent: number; setRetailPercent: (v: number) => void;
  residentialDeductPct: number; setResidentialDeductPct: (v: number) => void;
  residentialEfficiency: number; setResidentialEfficiency: (v: number) => void;
  hospitalityDeductPct: number; setHospitalityDeductPct: (v: number) => void;
  hospitalityEfficiency: number; setHospitalityEfficiency: (v: number) => void;
  retailDeductPct: number; setRetailDeductPct: (v: number) => void;
  retailEfficiency: number; setRetailEfficiency: (v: number) => void;
  projectType: ProjectType;
  currency: string;
  totalLandArea: number;
  totalLandValue: number;
  landValuePerSqm: number;
  cashValue: number;
  inKindValue: number;
  cashPercent: number;
  inKindPercent: number;
  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;
  projectRoadsArea: number;
  projectNDA: number;
  totalProjectGFA: number;
  residentialGFA: number;
  hospitalityGFA: number;
  retailGFA: number;
  residentialBUA: number;
  residentialNetSaleable: number;
  hospitalityBUA: number;
  hospitalityNetSaleable: number;
  retailBUA: number;
  retailNetSaleable: number;
  readOnly: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: '5px 8px',
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

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  fontWeight: 'var(--fw-semibold)',
};

export default function Module1Area({
  landParcels, setLandParcels,
  projectRoadsPct, setProjectRoadsPct,
  projectFAR, setProjectFAR,
  projectNonEnclosedPct, setProjectNonEnclosedPct,
  residentialPercent, setResidentialPercent,
  hospitalityPercent, setHospitalityPercent,
  retailPercent, setRetailPercent,
  residentialDeductPct, setResidentialDeductPct,
  residentialEfficiency, setResidentialEfficiency,
  hospitalityDeductPct, setHospitalityDeductPct,
  hospitalityEfficiency, setHospitalityEfficiency,
  retailDeductPct, setRetailDeductPct,
  retailEfficiency, setRetailEfficiency,
  projectType, currency,
  totalLandArea, totalLandValue, landValuePerSqm,
  cashValue, inKindValue, cashPercent, inKindPercent,
  showResidential, showHospitality, showRetail,
  projectRoadsArea, projectNDA, totalProjectGFA,
  residentialGFA, hospitalityGFA, retailGFA,
  residentialBUA, residentialNetSaleable,
  hospitalityBUA, hospitalityNetSaleable,
  retailBUA, retailNetSaleable,
  readOnly,
}: Module1AreaProps) {

  const addParcel = () => {
    const newId = Math.max(0, ...landParcels.map(p => p.id)) + 1;
    setLandParcels([...landParcels, { id: newId, name: `Land ${newId}`, area: 0, rate: 0, cashPct: 60, inKindPct: 40 }]);
  };

  const updateParcel = (id: number, field: keyof LandParcel, value: string | number) => {
    setLandParcels(landParcels.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      if (field === 'cashPct')   updated.inKindPct = 100 - Number(value);
      if (field === 'inKindPct') updated.cashPct   = 100 - Number(value);
      return updated;
    }));
  };

  const removeParcel = (id: number) => {
    if (landParcels.length <= 1) return;
    setLandParcels(landParcels.filter(p => p.id !== id));
  };

  const assetMixTotal = (showResidential ? residentialPercent : 0)
    + (showHospitality ? hospitalityPercent : 0)
    + (showRetail ? retailPercent : 0);

  const assetMixValid = Math.abs(assetMixTotal - 100) < 0.01;

  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          Land &amp; Area
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0 }}>
          Define land parcels, site parameters, and GFA hierarchy
        </p>
      </div>

      {/* Land Parcels Table */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Land Parcels
          </h3>
          {!readOnly && (
            <button className="btn-primary rbac-action-btn" style={{ fontSize: '12px', padding: '5px 12px' }} onClick={addParcel}>
              + Add Parcel
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Parcel Name</th>
                <th>Area (sqm)</th>
                <th>Rate (/{currency} per sqm)</th>
                <th>Total Value</th>
                <th>Cash %</th>
                <th>In-Kind %</th>
                <th>Cash Value</th>
                <th>In-Kind Value</th>
                {!readOnly && <th>Del</th>}
              </tr>
            </thead>
            <tbody>
              {landParcels.map(p => {
                const totalVal = p.area * p.rate;
                const cashVal  = totalVal * p.cashPct / 100;
                const ikVal    = totalVal - cashVal;
                return (
                  <tr key={p.id}>
                    <td>
                      <input
                        style={{ ...inputStyle, minWidth: '100px' }}
                        type="text"
                        value={p.name}
                        onChange={e => updateParcel(p.id, 'name', e.target.value)}
                        disabled={readOnly}
                      />
                    </td>
                    <td>
                      <input
                        style={{ ...inputStyle, textAlign: 'right' }}
                        type="number"
                        min={0}
                        value={p.area}
                        onChange={e => updateParcel(p.id, 'area', Number(e.target.value))}
                        disabled={readOnly}
                      />
                    </td>
                    <td>
                      <input
                        style={{ ...inputStyle, textAlign: 'right' }}
                        type="number"
                        min={0}
                        value={p.rate}
                        onChange={e => updateParcel(p.id, 'rate', Number(e.target.value))}
                        disabled={readOnly}
                      />
                    </td>
                    <td style={{ fontWeight: 'var(--fw-semibold)' }}>{formatNumber(totalVal)}</td>
                    <td>
                      <input
                        style={{ ...inputStyle, textAlign: 'right' }}
                        type="number"
                        min={0}
                        max={100}
                        value={p.cashPct}
                        onChange={e => updateParcel(p.id, 'cashPct', Number(e.target.value))}
                        disabled={readOnly}
                      />
                    </td>
                    <td>
                      <input
                        style={{ ...inputStyle, textAlign: 'right' }}
                        type="number"
                        min={0}
                        max={100}
                        value={p.inKindPct}
                        onChange={e => updateParcel(p.id, 'inKindPct', Number(e.target.value))}
                        disabled={readOnly}
                      />
                    </td>
                    <td>{formatNumber(cashVal)}</td>
                    <td>{formatNumber(ikVal)}</td>
                    {!readOnly && (
                      <td>
                        <button
                          className="btn-danger rbac-action-btn rbac-hide-in-readonly"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => removeParcel(p.id)}
                          disabled={landParcels.length <= 1}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>TOTAL</td>
                <td>{formatNumber(totalLandArea)}</td>
                <td>{formatNumber(landValuePerSqm)}/sqm</td>
                <td>{formatNumber(totalLandValue)}</td>
                <td>{cashPercent.toFixed(1)}%</td>
                <td>{inKindPercent.toFixed(1)}%</td>
                <td>{formatNumber(cashValue)}</td>
                <td>{formatNumber(inKindValue)}</td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* M1.9: Asset Mix + Deduction & Efficiency panels removed.
          The per-category mix (residential/hospitality/retail %) and
          per-category deduct/efficiency are now derived transparently
          from per-asset state at the platform layer (see
          RealEstatePlatform.tsx — residentialPercent = resAsset.allocationPct).
          Edits live on the Asset card under the Hierarchy tab; the Area
          Hierarchy table below renders the resulting cascade so users
          can verify the math. */}
      <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
          Site Parameters
        </h3>

        {[
          { label: 'Project Roads / Infrastructure %', value: projectRoadsPct, setter: setProjectRoadsPct, suffix: '%', min: 0, max: 50, step: 0.5 },
          { label: 'Floor Area Ratio (FAR)',            value: projectFAR,      setter: setProjectFAR,      suffix: '',  min: 0, max: 10, step: 0.1 },
          { label: 'Non-Enclosed Area %',               value: projectNonEnclosedPct, setter: setProjectNonEnclosedPct, suffix: '%', min: 0, max: 100, step: 1 },
        ].map(row => (
          <div key={row.label} style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={{ fontSize: 'var(--font-meta)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-body)', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {row.label}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="number"
                min={row.min}
                max={row.max}
                step={row.step}
                value={row.value}
                onChange={e => row.setter(Number(e.target.value))}
                disabled={readOnly}
              />
              {row.suffix && <span style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)' }}>{row.suffix}</span>}
            </div>
          </div>
        ))}

        <div style={{
          fontSize: 'var(--font-meta)',
          color: 'var(--color-meta)',
          marginTop: 'var(--sp-2)',
          paddingTop: 'var(--sp-2)',
          borderTop: '1px solid var(--color-border)',
          lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--color-heading)' }}>Where did Asset Mix go?</strong> Per-category allocation
          (Residential / Hospitality / Retail %) and per-category deduct
          / efficiency now live on each asset card under the
          <strong> Hierarchy</strong> tab. The Area Hierarchy table below
          rolls those edits up automatically — no duplicate input here.
        </div>
        {!assetMixValid && (
          <div className="alert-error" style={{ marginTop: 'var(--sp-2)' }}>
            ⚠ Asset allocations sum to {assetMixTotal.toFixed(1)}% (must = 100). Adjust per-asset allocation on the Hierarchy tab.
          </div>
        )}
      </div>

      {/* Area Hierarchy Output — calculated panel (FAST formula grey-pale + heading) */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)', background: calcOutputStyle.background }}>
        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
          Area Hierarchy (sqm)
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Level</th>
                <th>Total Project</th>
                {showResidential && <th style={{ color: 'color-mix(in srgb, var(--color-on-primary-navy) 60%, var(--color-navy))' }}>Residential</th>}
                {showHospitality && <th style={{ color: 'color-mix(in srgb, var(--color-on-primary-navy) 60%, var(--color-gold))' }}>Hospitality</th>}
                {showRetail     && <th style={{ color: 'color-mix(in srgb, var(--color-on-primary-navy) 60%, var(--color-negative))' }}>Retail</th>}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Total Land Area',    total: totalLandArea,   res: totalLandArea * (residentialPercent / 100), hosp: totalLandArea * (hospitalityPercent / 100), ret: totalLandArea * (retailPercent / 100) },
                { label: 'Roads / Infra',      total: projectRoadsArea, res: projectRoadsArea * (residentialPercent / 100), hosp: projectRoadsArea * (hospitalityPercent / 100), ret: projectRoadsArea * (retailPercent / 100) },
                { label: 'Net Developable Area (NDA)', total: projectNDA, res: projectNDA * (residentialPercent / 100), hosp: projectNDA * (hospitalityPercent / 100), ret: projectNDA * (retailPercent / 100) },
                { label: 'Gross Floor Area (GFA)', total: totalProjectGFA, res: residentialGFA, hosp: hospitalityGFA, ret: retailGFA },
                { label: 'Built-Up Area (BUA)', total: residentialBUA + hospitalityBUA + retailBUA, res: residentialBUA, hosp: hospitalityBUA, ret: retailBUA },
                { label: 'Net Saleable Area (NSA)', total: residentialNetSaleable + hospitalityNetSaleable + retailNetSaleable, res: residentialNetSaleable, hosp: hospitalityNetSaleable, ret: retailNetSaleable },
              ].map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatNumber(row.total)}</td>
                  {showResidential && <td>{formatNumber(row.res)}</td>}
                  {showHospitality && <td>{formatNumber(row.hosp)}</td>}
                  {showRetail      && <td>{formatNumber(row.ret)}</td>}
                </tr>
              ))}
              <tr>
                <td>Land Value ({currency})</td>
                <td>{formatCurrency(totalLandValue, currency)}</td>
                {showResidential && <td>{formatCurrency(totalLandValue * residentialPercent / 100, currency)}</td>}
                {showHospitality && <td>{formatCurrency(totalLandValue * hospitalityPercent / 100, currency)}</td>}
                {showRetail      && <td>{formatCurrency(totalLandValue * retailPercent / 100, currency)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
