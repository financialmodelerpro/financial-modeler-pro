'use client';

/**
 * OverrideBadge.tsx (Cases follow-up B, 2026-06-04)
 *
 * Per-input "≠ Management" badge + inline Reset for scenario cases. When the
 * active case is a scenario (not the Management base) AND the field at `path`
 * differs from the base model, the badge appears next to the input; clicking
 * Reset drops that single override (resetOverridePath) so the field returns to
 * the Management value.
 *
 * `path` is the diff-grammar path the cases engine uses (same scheme as
 * buildOverrides / resetOverridePath), e.g. "project.tax.rate",
 * "assets[id=A1].revenue.sell.pricePerUnit". The badge is opt-in per input, so
 * surfaces adopt it incrementally by dropping <OverrideBadge path="..." /> next
 * to the relevant label.
 */
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../../lib/state/module1-store';
import { getByPath } from '../../../lib/cases/applyOverrides';

/** Whether the active case is a scenario and the field at `path` is overridden
 *  (differs from the Management base model). */
export function useFieldOverride(path: string): { isScenario: boolean; isOverridden: boolean } {
  return useModule1Store(
    useShallow((s) => {
      const active = s.cases.find((c) => c.id === s.activeCaseId);
      const isScenario = !!active && active.role !== 'base';
      if (!isScenario) return { isScenario: false, isOverridden: false };
      const baseVal = getByPath(s.baseSnapshot, path);
      const liveVal = getByPath(s as unknown as HydrateSnapshot, path);
      return { isScenario, isOverridden: JSON.stringify(baseVal ?? null) !== JSON.stringify(liveVal ?? null) };
    }),
  );
}

export function OverrideBadge({ path }: { path: string }): React.JSX.Element | null {
  const { isScenario, isOverridden } = useFieldOverride(path);
  if (!isScenario || !isOverridden) return null;
  const reset = (): void => useModule1Store.getState().resetOverridePath(path);
  return (
    <span
      data-testid={`override-badge-${path}`}
      title="This field differs from the Management (base) case"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6,
        fontSize: 10, fontWeight: 600, lineHeight: '14px',
        color: 'var(--color-warning, #92400e)',
        background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
        border: '1px solid var(--color-warning, #92400e)',
        borderRadius: 4, padding: '0 5px', verticalAlign: 'middle',
      }}
    >
      ≠ Management
      <button
        type="button"
        onClick={reset}
        title="Reset this field to the Management value"
        data-testid={`override-reset-${path}`}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 10, fontWeight: 700, textDecoration: 'underline', padding: 0 }}
      >
        Reset
      </button>
    </span>
  );
}
