/**
 * PlanMatrix.tsx
 *
 * Pure, presentational feature-by-plan matrix for the admin plan builder.
 * Rows are features from features_registry in one ordered list (display_order),
 * with category shown as a visual grouping band only. Columns are plans. Gate
 * features render a checkbox; limit features render a number box. Each row shows
 * a read-only build_status tag so a stub is never assigned as if it were live.
 *
 * No state, no data fetching: the page passes data + callbacks. Kept pure so it
 * can also be server-rendered for screenshot proof.
 */
import React from 'react';

export type FeatureType = 'gate' | 'limit' | 'metered';
export type BuildStatus = 'live' | 'in_development' | 'stub' | 'needs_build';

export type ModuleStatus = 'live' | 'coming_soon' | 'pro' | 'enterprise';

export interface MatrixFeature {
  feature_key: string;
  label: string;
  category: string;
  feature_type: FeatureType;
  build_status: BuildStatus;
  display_order: number;
  /** Present for module rows derived from the live registry. When set, the
   *  on-row tag reflects this live status instead of build_status. */
  moduleStatus?: ModuleStatus;
  /** Customer-facing visibility (mig 164), non-module rows only. */
  visible?: boolean;
  /** Short blurb shown as the pricing info popover (mig 168). Editable here. */
  description?: string | null;
}
export interface MatrixPlan {
  id?: string;
  plan_key: string;
  label: string;
  active: boolean;
  display_order: number;
  // Pricing (mig 162). Null prices = unpriced; contact_sales overrides the
  // number with a "Contact sales" treatment.
  price_monthly?: number | null;
  price_annual?: number | null;
  currency?: string | null;
  contact_sales?: boolean;
  popular?: boolean;
  badge_text?: string | null;
  /** Trial length in days; meaningful on the Trial plan (mig 165). */
  trial_days?: number | null;
  /** Payment provider price / product ids (mig 166). Empty until a provider is
   *  approved and an admin pastes the real ids. Server-read for checkout. */
  paddle_price_id_monthly?: string | null;
  paddle_price_id_annual?: string | null;
  paypro_product_id?: string | null;
}
export interface CellValue { included: boolean; limit_value: number | null }

export interface PlanMatrixProps {
  features: MatrixFeature[];
  plans: MatrixPlan[];
  cell: (planKey: string, featureKey: string) => CellValue;
  onToggle?: (planKey: string, featureKey: string, included: boolean) => void;
  onLimit?: (planKey: string, featureKey: string, value: number | null) => void;
  /** Toggle customer-facing visibility of a NON-MODULE feature (mig 164). */
  onToggleVisible?: (featureKey: string, visible: boolean) => void;
  /** Save the short pricing description for a feature (mig 168). */
  onSaveDescription?: (featureKey: string, description: string) => void;
  readOnly?: boolean;
}

const BUILD_TAG: Record<BuildStatus, { label: string; bg: string; fg: string }> = {
  live:           { label: 'Live',            bg: '#dcfce7', fg: '#166534' },
  in_development: { label: 'In development',  bg: '#dbeafe', fg: '#1e40af' },
  stub:           { label: 'Stub',            bg: '#fef3c7', fg: '#92400e' },
  needs_build:    { label: 'Needs build',     bg: '#f3f4f6', fg: '#6b7280' },
};

// Live module status (from the registry) drives the module-row tag.
const MODULE_TAG: Record<ModuleStatus, { label: string; bg: string; fg: string }> = {
  live:        { label: 'Live',        bg: '#dcfce7', fg: '#166534' },
  coming_soon: { label: 'Coming soon', bg: '#fef3c7', fg: '#92400e' },
  pro:         { label: 'Pro',         bg: '#ede9fe', fg: '#6d28d9' },
  enterprise:  { label: 'Enterprise',  bg: '#e0e7ff', fg: '#3730a3' },
};

function StatusTag({ feature }: { feature: MatrixFeature }): React.JSX.Element {
  if (feature.moduleStatus) {
    const t = MODULE_TAG[feature.moduleStatus];
    return (
      <span data-testid={`module-status-${feature.moduleStatus}`} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
        {t.label}
      </span>
    );
  }
  const t = BUILD_TAG[feature.build_status] ?? BUILD_TAG.needs_build;
  return (
    <span data-testid={`build-status-${feature.build_status}`} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {t.label}
    </span>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: '#fff', textAlign: 'center', whiteSpace: 'nowrap' };
const tdLabel: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #e5e7eb', position: 'sticky', left: 0, background: '#fff', zIndex: 1 };
const tdCell: React.CSSProperties = { padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #f1f5f9' };

export function PlanMatrix({ features, plans, cell, onToggle, onLimit, onToggleVisible, onSaveDescription, readOnly }: PlanMatrixProps): React.JSX.Element {
  // Single ordered list; category bands are inserted when the category changes.
  const ordered = [...features].sort((a, b) => a.display_order - b.display_order);
  const rows: React.JSX.Element[] = [];
  let lastCategory = '';

  for (const f of ordered) {
    if (f.category !== lastCategory) {
      lastCategory = f.category;
      rows.push(
        <tr key={`cat-${f.category}`} data-testid={`category-band-${f.category}`}>
          <td colSpan={plans.length + 1} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {f.category}
          </td>
        </tr>,
      );
    }
    rows.push(
      <tr key={f.feature_key} data-testid={`feature-row-${f.feature_key}`}>
        <td style={tdLabel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, opacity: !f.moduleStatus && f.visible === false ? 0.5 : 1 }}>{f.label}</span>
            <StatusTag feature={f} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{f.feature_key} ({f.feature_type})</span>
            {/* Customer-facing visibility toggle: NON-MODULE features only.
                Module visibility lives in the Modules tab. */}
            {!f.moduleStatus && onToggleVisible && (
              <label data-testid={`feature-visible-${f.feature_key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: f.visible === false ? '#b91c1c' : '#16a34a', cursor: readOnly ? 'default' : 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <input type="checkbox" disabled={readOnly} checked={f.visible !== false}
                  onChange={(e) => onToggleVisible(f.feature_key, e.target.checked)} style={{ width: 11, height: 11 }} />
                {f.visible === false ? 'Hidden' : 'Shown'}
              </label>
            )}
          </div>
          {/* Editable short description (mig 168): shown as the pricing info
              popover on the public + in-app comparison. Saves on blur. */}
          {onSaveDescription && (
            <input
              key={`desc-${f.feature_key}`}
              data-testid={`feature-desc-${f.feature_key}`}
              defaultValue={f.description ?? ''}
              disabled={readOnly}
              placeholder="Short description (shown on pricing)"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if ((f.description ?? '') !== v) onSaveDescription(f.feature_key, v);
              }}
              style={{ marginTop: 4, width: '100%', minWidth: 180, padding: '3px 6px', fontSize: 11, color: '#475569', border: '1px solid #e2e8f0', borderRadius: 5 }}
            />
          )}
        </td>
        {plans.map((p) => {
          const v = cell(p.plan_key, f.feature_key);
          const cellTestId = `cell-${p.plan_key}-${f.feature_key}`;
          if (f.feature_type === 'limit') {
            const unlimited = v.limit_value === -1;
            return (
              <td key={p.plan_key} style={tdCell}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <input
                    type="number"
                    data-testid={cellTestId}
                    disabled={readOnly || unlimited}
                    value={unlimited ? '' : (v.limit_value ?? '')}
                    placeholder={unlimited ? 'Unlimited' : '0'}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onLimit?.(p.plan_key, f.feature_key, raw === '' ? null : parseInt(raw, 10));
                    }}
                    style={{ width: 78, padding: '3px 6px', fontSize: 12, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: 5, background: unlimited ? '#f1f5f9' : '#fff' }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#64748b', cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      data-testid={`${cellTestId}-unlimited`}
                      disabled={readOnly}
                      checked={unlimited}
                      onChange={(e) => onLimit?.(p.plan_key, f.feature_key, e.target.checked ? -1 : null)}
                      style={{ width: 12, height: 12 }}
                    />
                    Unlimited
                  </label>
                </div>
              </td>
            );
          }
          return (
            <td key={p.plan_key} style={tdCell}>
              <input
                type="checkbox"
                data-testid={cellTestId}
                disabled={readOnly}
                checked={v.included}
                onChange={(e) => onToggle?.(p.plan_key, f.feature_key, e.target.checked)}
                style={{ width: 16, height: 16, cursor: readOnly ? 'default' : 'pointer' }}
              />
            </td>
          );
        })}
      </tr>,
    );
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }} data-testid="plan-matrix">
      <table style={{ borderCollapse: 'collapse', minWidth: 480, width: '100%' }}>
        <thead>
          <tr style={{ background: '#0D2E5A' }}>
            <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#0D2E5A', zIndex: 2 }}>
              Feature ({ordered.length})
            </th>
            {plans.map((p) => (
              <th key={p.plan_key} style={th} data-testid={`plan-col-${p.plan_key}`}>
                {p.label}{!p.active && <div style={{ fontSize: 9, color: '#FCA5A5', fontWeight: 700 }}>inactive</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
