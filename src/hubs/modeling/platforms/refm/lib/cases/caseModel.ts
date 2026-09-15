/**
 * caseModel.ts (2026-09-15, step 8)
 *
 * A SCENARIO'S MODEL IS THE BASE WITH ITS OVERRIDES, SETTLED.
 *
 * `applyOverrides` alone is value-only: it writes the overridden fields and runs
 * none of the passes that turn an input into what the engine prices. So a type
 * price or a cost standard overridden in a scenario changed the stored number
 * and nothing it feeds (every Table 5 row of the type, every standard-origin
 * capex override) unless that scenario was the one the project opened on. Every
 * surface that builds a scenario's model builds it here instead, so the active
 * scenario, the comparison, the year-on-year report and the exports agree.
 *
 * AND A DERIVED VALUE IS NEVER AN OVERRIDE. A settled scenario differs from the
 * base in the values the settle wrote (a type-priced row's price, a
 * standard-origin capex override). Diffing the two would store those as the
 * scenario's own overrides, and a stored override pins the value: resetting the
 * type price would leave the rows at the old scenario price, and a later base
 * edit of the standard would never reach the scenario (the shape of TRAPS
 * 7.47). `withoutDerivedOverrides` drops them from any override map built by a
 * diff, so they are re-derived from the inputs the scenario does override.
 *
 * No em dashes in this file.
 */
import { applyOverrides } from './applyOverrides';
import { settleModel } from '../state/settleModel';
import type { HydrateSnapshot } from '../state/module1-store';

export function caseModelOf(base: HydrateSnapshot, overrides: Record<string, unknown> | undefined): HydrateSnapshot {
  const applied = applyOverrides(base, overrides);
  if (!overrides || Object.keys(overrides).length === 0) return applied;
  return settleModel(applied).model;
}

const PRICE_FIELDS = ['unitPrice', 'pricePerSqm', 'pricePerUnit'] as const;

export function withoutDerivedOverrides(overrides: Record<string, unknown>, live: HydrateSnapshot): Record<string, unknown> {
  const out = { ...overrides };
  const m = live as unknown as {
    costOverrides?: Array<{ assetId: string; lineId: string; origin?: string }>;
    subUnits?: Array<{ id: string; priceStated?: boolean }>;
  };
  for (const path of Object.keys(overrides)) {
    if (path.startsWith('costOverrides[')) {
      const close = path.indexOf(']');
      const [assetId, lineId] = path.slice('costOverrides['.length, close).split('::');
      const o = (m.costOverrides ?? []).find((x) => x.assetId === assetId && x.lineId === lineId);
      if (o?.origin === 'standard') delete out[path];
      continue;
    }
    if (path.startsWith('subUnits[id=')) {
      const field = PRICE_FIELDS.find((f) => path.endsWith(`].${f}`));
      if (!field) continue;
      const id = path.slice('subUnits[id='.length, -(field.length + 2));
      const row = (m.subUnits ?? []).find((u) => u.id === id);
      if (row?.priceStated === false) delete out[path];
    }
  }
  return out;
}
