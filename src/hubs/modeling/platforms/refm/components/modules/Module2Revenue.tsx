'use client';

/**
 * Module2Revenue.tsx (M2 Pass 1)
 *
 * Module 2 Revenue shell. Groups every asset by its M1 strategy
 * (Sell / Operate / Lease / Sell + Manage) so the user picks an asset
 * and lands on the strategy-specific revenue form. No engine wired
 * yet; each per-asset card shows a "Configure Revenue (coming soon)"
 * stub. Build-order per [[project_m2_revenue_plan]]:
 *   Phase 1: Residential Sell (canonical reference: MAAD Excel)
 *   Phase 2: Hospitality Operate
 *   Phase 3: Lease (Retail / Office)
 *   Phase 4: Sell + Manage
 */

import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset, AssetStrategy, Phase, SubUnit } from '../../lib/state/module1-types';
import { computeSubUnitArea } from '@/src/core/calculations';
import { formatArea } from '@/src/core/formatters';
import Module2SellModal from '../modals/Module2SellModal';

interface StrategyMeta {
  key: AssetStrategy;
  groupLabel: string;
  phaseLabel: string;
  blurb: string;
  badge: string;
  accent: string;
}

const STRATEGY_GROUPS: readonly StrategyMeta[] = [
  {
    key: 'Sell',
    groupLabel: 'Residential / Sell',
    phaseLabel: 'Phase 1 (build first)',
    blurb: 'Sub-units released in cohorts, payment milestones, IFRS 15 recognition (Point-in-Time at handover or Over-Time POC), escrow held until trigger.',
    badge: '🏠',
    accent: 'var(--color-navy, #0f2e4c)',
  },
  {
    key: 'Operate',
    groupLabel: 'Hospitality / Operate',
    phaseLabel: 'Phase 2',
    blurb: 'USAH revenue lines (Rooms / F&B / Banquets / Other), occupancy ramp to stabilization, ADR indexation, recognition = cash for simple cases.',
    badge: '🏨',
    accent: 'var(--color-success, #166534)',
  },
  {
    key: 'Lease',
    groupLabel: 'Retail / Office / Lease',
    phaseLabel: 'Phase 3',
    blurb: 'Lease-up curve per sub-unit type, base rent + escalations or rent review resets, rent-free incentive period, optional CAM and turnover rent.',
    badge: '🏬',
    accent: 'var(--color-warning, #92400e)',
  },
  {
    key: 'Sell + Manage',
    groupLabel: 'Sell + Manage (branded residences)',
    phaseLabel: 'Phase 4',
    blurb: 'Sell side mirrors Phase 1 + a management fee layer on operating revenue / gross room revenue / NOI from operations year onward.',
    badge: '🏛️',
    accent: 'var(--color-info, #1d4ed8)',
  },
];

function phaseLabelById(phases: Phase[], id: string): string {
  return phases.find((p) => p.id === id)?.name ?? 'Unassigned phase';
}

function subUnitSummary(subUnits: SubUnit[]): string {
  if (subUnits.length === 0) return 'No sub-units yet';
  const totalCount = subUnits
    .filter((u) => u.metric === 'units')
    .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
  const totalArea = subUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
  const countPart = totalCount > 0 ? `${Math.round(totalCount).toLocaleString('en-US')} units` : null;
  const areaPart = totalArea > 0 ? `${formatArea(totalArea, 0)} sqm` : null;
  return [countPart, areaPart].filter(Boolean).join(' · ') || 'No measurements';
}

export default function Module2Revenue(): React.JSX.Element {
  const { phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
    })),
  );

  const visibleAssets = assets.filter((a) => a.visible !== false && a.isCompanion !== true);
  const [sellModalAssetId, setSellModalAssetId] = useState<string | null>(null);
  const sellModalAsset = sellModalAssetId ? assets.find((a) => a.id === sellModalAssetId) : null;

  return (
    <div data-testid="module2-shell" style={{ padding: 'var(--sp-2)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h1)', color: 'var(--color-heading)', margin: 0 }}>
          Module 2 · Revenue
        </h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Revenue is asset-strategy-driven. Pick an asset to configure its
          revenue form. Each strategy has its own logic, IFRS 15 treatment,
          and cash profile. MAAD Residential Cashflow v1.16 is the canonical
          reference for Phase 1 Sell.
        </p>
      </div>

      {visibleAssets.length === 0 && (
        <div
          data-testid="module2-no-assets"
          style={{
            padding: 'var(--sp-3)',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-small)',
          }}
        >
          No assets yet. Add assets on Module 1 · Tab 2 (Assets & Sub-units),
          then come back here to configure their revenue.
        </div>
      )}

      {STRATEGY_GROUPS.map((g) => {
        const group = visibleAssets.filter((a) => a.strategy === g.key);
        return (
          <section
            key={g.key}
            data-testid={`module2-group-${g.key.replace(/[^a-zA-Z]/g, '').toLowerCase()}`}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--sp-1)',
                marginBottom: 'var(--sp-1)',
                paddingBottom: 'var(--sp-1)',
                borderBottom: `2px solid ${g.accent}`,
              }}
            >
              <span style={{ fontSize: 18 }}>{g.badge}</span>
              <h2 style={{ fontSize: 'var(--font-h3)', color: g.accent, margin: 0 }}>
                {g.groupLabel}
              </h2>
              <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', fontStyle: 'italic' }}>
                {g.phaseLabel}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--font-micro)',
                  color: 'var(--color-meta)',
                  fontWeight: 600,
                }}
                data-testid={`module2-group-${g.key.replace(/[^a-zA-Z]/g, '').toLowerCase()}-count`}
              >
                {group.length} asset{group.length === 1 ? '' : 's'}
              </span>
            </div>
            <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 'var(--sp-1)' }}>
              {g.blurb}
            </p>

            {group.length === 0 ? (
              <div
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: 'var(--color-surface)',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--font-small)',
                  fontStyle: 'italic',
                }}
              >
                No assets with this strategy yet.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 'var(--sp-1)',
                }}
              >
                {group.map((a) => {
                  const myUnits = subUnits.filter((u) => u.assetId === a.id);
                  return (
                    <div
                      key={a.id}
                      data-testid={`module2-asset-${a.id}`}
                      style={{
                        padding: 'var(--sp-2)',
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{a.name}</div>
                        <span
                          style={{
                            fontSize: 'var(--font-micro)',
                            color: g.accent,
                            background: `color-mix(in srgb, ${g.accent} 12%, transparent)`,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontWeight: 600,
                          }}
                        >
                          {a.strategy}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
                        {phaseLabelById(phases, a.phaseId)} · {a.type ?? 'Untyped'} · {a.status ?? 'planned'}
                      </div>
                      <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-body)' }}>
                        {subUnitSummary(myUnits)}
                      </div>
                      {g.key === 'Sell' ? (
                        <button
                          type="button"
                          data-testid={`module2-asset-${a.id}-configure`}
                          onClick={() => setSellModalAssetId(a.id)}
                          style={{
                            marginTop: 'auto',
                            padding: '6px 10px',
                            background: g.accent,
                            color: 'var(--color-on-primary-navy)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-small)',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          {a.revenue?.sell ? 'Edit Revenue Config' : 'Configure Revenue'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          data-testid={`module2-asset-${a.id}-configure`}
                          title="Revenue form for this strategy is being built."
                          style={{
                            marginTop: 'auto',
                            padding: '6px 10px',
                            background: 'var(--color-surface-alt, #f3f4f6)',
                            color: 'var(--color-text-muted)',
                            border: '1px dashed var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-small)',
                            cursor: 'not-allowed',
                            fontStyle: 'italic',
                          }}
                        >
                          Configure Revenue (coming soon)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {sellModalAsset && (
        <Module2SellModal
          asset={sellModalAsset}
          onClose={() => setSellModalAssetId(null)}
        />
      )}
    </div>
  );
}
