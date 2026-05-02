'use client';

/**
 * Module1Hierarchy.tsx
 *
 * Phase M1.5/6 — read-only tree view of the 5-layer REFM project
 * hierarchy:
 *
 *   Master Holding (optional, singleton)
 *     └── Sub-Project 1..N        (Architecture sheet "Fund")
 *           └── Phase 1..N
 *                 └── Asset 1..N
 *                       └── Sub-Unit 1..N
 *
 * Read-only is deliberate: this commit only makes the structure visible
 * so a user opening a brand-new (assets=[]) project lands on a non-empty
 * surface and can see what they're about to build. CRUD lands across
 * M1.5/7 (Sub-Project), M1.5/8 (Phase), M1.5/9 (Asset + Sub-Unit), and
 * M1.5/10 (Master Holding toggle + fields).
 *
 * This component subscribes to useModule1Store directly rather than
 * receiving props. Two reasons:
 *   (a) every other M1 tab pre-dates the store and was wired by Phase
 *       M1.R/4 via prop-drilling for backward compatibility with its
 *       existing prop interface; the Hierarchy tab is the first M1.5
 *       surface so it has no legacy interface to preserve.
 *   (b) the data this tab reads (subProjects + phases + assets +
 *       subUnits + masterHolding) is exactly the slice the Module1
 *       store owns, so wrapping it in props would just be churn.
 *
 * useShallow keeps the subscription stable: the component re-renders
 * only when one of the hierarchy slices actually changes identity.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';

// ── Visual tokens ──────────────────────────────────────────────────────────
// Reuse the FAST navy palette established by Phases 4.6 → 4.15. The
// hierarchy tree is read-only so every value uses the calc-output style
// (grey-pale bg / heading text) — input blue is reserved for editable
// cells which arrive in the M1.5/7-10 CRUD commits.
const tokens = {
  // Per-tier accent colours so a long tree visually parses at a glance.
  // All taken from the existing palette — no new tokens introduced.
  mhAccent:       'var(--color-primary)',
  subProjAccent:  'var(--color-navy)',
  phaseAccent:    'var(--color-info)',
  assetAccent:    'var(--color-positive)',
  subUnitAccent:  'var(--color-meta)',
};

const cardBase: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
};

const tierLabelStyle = (accent: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: accent,
  background: `color-mix(in srgb, ${accent} 12%, var(--color-surface))`,
  marginBottom: 4,
});

const nodeNameStyle: React.CSSProperties = {
  fontSize: 'var(--font-body)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-heading)',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  marginTop: 4,
  fontSize: 'var(--font-meta)',
  color: 'var(--color-meta)',
};

const metaPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const emptyHintStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  color: 'var(--color-meta)',
  fontStyle: 'italic',
  padding: '4px 0',
};

// Indent rail: a thin vertical line on the left of each child block so
// the parent / child relationship reads clearly even when nodes wrap.
const indentBlockStyle = (accent: string): React.CSSProperties => ({
  marginLeft: 'var(--sp-2)',
  paddingLeft: 'var(--sp-2)',
  borderLeft: `2px solid color-mix(in srgb, ${accent} 35%, var(--color-border))`,
});

// ── Component ──────────────────────────────────────────────────────────────
export default function Module1Hierarchy() {
  const { masterHolding, subProjects, phases, assets, subUnits, currency } = useModule1Store(useShallow((s) => ({
    masterHolding: s.masterHolding,
    subProjects:   s.subProjects,
    phases:        s.phases,
    assets:        s.assets,
    subUnits:      s.subUnits,
    currency:      s.currency,
  })));

  const phasesBySubProject = (subProjectId: string) =>
    phases.filter(p => p.subProjectId === subProjectId);

  const assetsByPhase = (phaseId: string) =>
    assets.filter(a => a.phaseId === phaseId);

  const subUnitsByAsset = (assetId: string) =>
    subUnits.filter(u => u.assetId === assetId);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--sp-3) 0' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          🗂️ Project Hierarchy
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0, lineHeight: 1.6 }}>
          5-layer structure: <strong>Master Holding → Sub-Project → Phase → Asset → Sub-Unit</strong>. Read-only view —
          editing arrives in subsequent M1.5 commits (Sub-Project / Phase / Asset / Sub-Unit / Master Holding CRUD).
        </p>
      </div>

      {/* ── Master Holding (optional) ── */}
      {masterHolding.enabled ? (
        <div style={{ ...cardBase, borderLeft: `4px solid ${tokens.mhAccent}` }}>
          <div style={tierLabelStyle(tokens.mhAccent)}>Master Holding</div>
          <div style={nodeNameStyle}>{masterHolding.name}</div>
          <div style={metaRowStyle}>
            <span style={metaPillStyle}>
              📐 Land cost: {masterHolding.landCostMethod === 'fixed' ? `${currency} ${masterHolding.landCostValue.toLocaleString()}` : `${masterHolding.landCostValue} (rate × allocated)`}
            </span>
            <span style={metaPillStyle}>
              🏦 Master debt: {currency} {masterHolding.masterDebtPrincipal.toLocaleString()} @ {masterHolding.masterDebtRate}% / {masterHolding.masterDebtTermPeriods} periods
            </span>
          </div>
        </div>
      ) : (
        <div style={{ ...cardBase, borderLeft: `4px solid color-mix(in srgb, ${tokens.mhAccent} 30%, var(--color-border))`, background: 'transparent' }}>
          <div style={tierLabelStyle(tokens.mhAccent)}>Master Holding</div>
          <div style={emptyHintStyle}>
            Disabled. Single-project layouts skip this layer; toggle on
            from M1.5/10 onwards to roll Sub-Projects up under a holding entity.
          </div>
        </div>
      )}

      {/* ── Sub-Projects ── */}
      <div style={indentBlockStyle(tokens.subProjAccent)}>
        {subProjects.length === 0 ? (
          <div style={{ ...cardBase, ...emptyHintStyle }}>No sub-projects.</div>
        ) : subProjects.map(sp => {
          const sps = phasesBySubProject(sp.id);
          return (
            <div key={sp.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.subProjAccent}` }}>
              <div style={tierLabelStyle(tokens.subProjAccent)}>Sub-Project</div>
              <div style={nodeNameStyle}>{sp.name}</div>
              <div style={metaRowStyle}>
                <span style={metaPillStyle}>💱 {sp.currency}</span>
                {sp.masterHoldingId
                  ? <span style={metaPillStyle}>↑ Rolls up to MH ({sp.revenueShareToMaster}% revenue share)</span>
                  : <span style={metaPillStyle}>Standalone (no Master Holding)</span>}
                <span style={metaPillStyle}>📅 {sps.length} phase{sps.length === 1 ? '' : 's'}</span>
              </div>

              {/* ── Phases under this Sub-Project ── */}
              <div style={indentBlockStyle(tokens.phaseAccent)}>
                {sps.length === 0 ? (
                  <div style={emptyHintStyle}>No phases yet.</div>
                ) : sps.map(phase => {
                  const phaseAssets = assetsByPhase(phase.id);
                  return (
                    <div key={phase.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.phaseAccent}` }}>
                      <div style={tierLabelStyle(tokens.phaseAccent)}>Phase</div>
                      <div style={nodeNameStyle}>{phase.name}</div>
                      <div style={metaRowStyle}>
                        <span style={metaPillStyle}>🛠 Construction: {phase.constructionPeriods} periods (start {phase.constructionStart})</span>
                        <span style={metaPillStyle}>🏨 Operations: {phase.operationsPeriods} periods (start {phase.operationsStart})</span>
                        {phase.overlapPeriods > 0 && <span style={metaPillStyle}>↔ Overlap: {phase.overlapPeriods}</span>}
                        <span style={metaPillStyle}>🧱 {phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'}</span>
                      </div>

                      {/* ── Assets under this Phase ── */}
                      <div style={indentBlockStyle(tokens.assetAccent)}>
                        {phaseAssets.length === 0 ? (
                          <div style={emptyHintStyle}>No assets in this phase.</div>
                        ) : phaseAssets.map(asset => {
                          const aSubUnits = subUnitsByAsset(asset.id);
                          return (
                            <div key={asset.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.assetAccent}` }}>
                              <div style={tierLabelStyle(tokens.assetAccent)}>Asset</div>
                              <div style={nodeNameStyle}>
                                {asset.name}
                                {!asset.visible && <span style={{ marginLeft: 8, fontSize: 'var(--font-micro)', color: 'var(--color-meta)', fontWeight: 'var(--fw-normal)' }}>(hidden)</span>}
                              </div>
                              <div style={metaRowStyle}>
                                <span style={metaPillStyle}>🏷 {asset.category} · {asset.type}</span>
                                <span style={metaPillStyle}>📊 {asset.allocationPct}% allocation</span>
                                <span style={metaPillStyle}>➖ {asset.deductPct}% deduct</span>
                                <span style={metaPillStyle}>⚙ {asset.efficiencyPct}% efficiency</span>
                                <span style={metaPillStyle}>📦 {aSubUnits.length} sub-unit{aSubUnits.length === 1 ? '' : 's'}</span>
                              </div>

                              {/* ── Sub-Units under this Asset ── */}
                              {aSubUnits.length > 0 && (
                                <div style={indentBlockStyle(tokens.subUnitAccent)}>
                                  {aSubUnits.map(unit => (
                                    <div key={unit.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.subUnitAccent}`, marginBottom: 'var(--sp-1)' }}>
                                      <div style={tierLabelStyle(tokens.subUnitAccent)}>Sub-Unit</div>
                                      <div style={nodeNameStyle}>{unit.name}</div>
                                      <div style={metaRowStyle}>
                                        <span style={metaPillStyle}>{unit.metric === 'count' ? '#' : '㎡'} {unit.metricValue.toLocaleString()} {unit.metric === 'count' ? 'units' : 'sqm'}</span>
                                        <span style={metaPillStyle}>💵 {currency} {unit.unitPrice.toLocaleString()} / {unit.metric === 'count' ? 'unit' : 'sqm'}</span>
                                        {unit.priceEscalationPct !== undefined && unit.priceEscalationPct !== 0 && (
                                          <span style={metaPillStyle}>📈 {unit.priceEscalationPct}% escalation/year</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <p style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--font-meta)', color: 'var(--color-meta)', fontStyle: 'italic', textAlign: 'center' }}>
        CRUD coming in M1.5/7 (Sub-Project) → M1.5/8 (Phase) → M1.5/9 (Asset + Sub-Unit) → M1.5/10 (Master Holding).
      </p>
    </div>
  );
}
