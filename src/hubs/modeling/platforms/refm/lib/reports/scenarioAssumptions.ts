/**
 * scenarioAssumptions.ts (2026-09-21)
 *
 * THE ASSUMPTIONS-BY-CASE GRID, ONE BUILDER.
 *
 * Module 6 shows what each case assumes: the curated key drivers, then every
 * field any scenario overrides, grouped, with a note where a lever cannot move
 * results under the current settings. The workbook built that inline and the
 * report did not build it at all: it printed only the levers that DIVERGE,
 * taken from the year-on-year blocks, so on a project whose cases carry no
 * overrides (the live one) the report showed a list of cases and nothing else
 * while the workbook showed the whole grid. Two files, one model, different
 * answers to "what does this scenario assume".
 *
 * Rows come out as plain values, so a surface only has to print them.
 *
 * No em dashes in this file.
 */
import {
  buildGridContext, isPerPeriodLever, nonEconomicLeverReason,
  inactiveLeverReason, curatedDefaultFields, assumptionFor, groupAssumptionRows, leverNote,
  formatAssumptionValue, assumptionUnitSuffix, isAppliedValue,
} from '../cases/assumptionGrid';
import { enumerateOverridableFields, getByPath, type OverridableField } from '../cases/applyOverrides';
import type { HydrateSnapshot } from '../state/module1-store';
import type { CaseComparisonInput } from './caseComparisonReport';

export interface AssumptionCell {
  caseId: string;
  /** The value as the grid prints it, unit suffix included. */
  text: string;
  /** True when this case overrides the field (the workbook bolds it). */
  overridden: boolean;
}

export interface AssumptionRow {
  path: string;
  label: string;
  /** Indented under a grouped heading (a per-line lever, say). */
  indented: boolean;
  /** "not used under current settings", the lever's own note, or both. */
  note: string;
  cells: AssumptionCell[];
}

export interface AssumptionGroup {
  label: string;
  /** A sub-heading inside the group, for a lever that repeats per line. */
  items: Array<{ label: string | null; rows: AssumptionRow[] }>;
}

export interface AssumptionGrid {
  /** The cases, in the order the columns read. */
  columns: Array<{ id: string; name: string; isBase: boolean }>;
  groups: AssumptionGroup[];
  /** Said when there is nothing to compare, so a surface never prints a void. */
  emptyNote: string;
}

export const ASSUMPTIONS_EMPTY_NOTE =
  'No assumptions yet. Add one on the platform to start comparing values across cases.';

export function buildAssumptionGrid(input: CaseComparisonInput): AssumptionGrid {
  const base = input.baseModel as unknown as HydrateSnapshot;
  const columns = input.cases.map((c) => ({ id: c.id, name: c.name, isBase: c.role === 'base' }));
  const gridCtx = buildGridContext(base as never);
  const fields: OverridableField[] = enumerateOverridableFields(base)
    .filter((f) => !isPerPeriodLever(f.field) && !nonEconomicLeverReason(f.path, f.field));
  const fieldByPath = new Map(fields.map((f) => [f.path, f]));
  const overridesOf = (id: string): Record<string, unknown> =>
    (input.cases.find((c) => c.id === id)?.overrides ?? {}) as Record<string, unknown>;

  const allOverridePaths = new Set<string>();
  for (const c of input.cases) if (c.role !== 'base') Object.keys(c.overrides ?? {}).forEach((p) => allOverridePaths.add(p));

  const rowPaths: string[] = [];
  const seen = new Set<string>();
  const add = (p: string): void => { if (!seen.has(p)) { seen.add(p); rowPaths.push(p); } };
  curatedDefaultFields(base as never).forEach((f) => { if (!inactiveLeverReason(f.path, base as never)) add(f.path); });
  allOverridePaths.forEach(add);

  const built: Array<{ path: string; descriptor: ReturnType<typeof assumptionFor> }> = [];
  for (const path of rowPaths) {
    const baseVal = getByPath(base, path);
    // A curated lever the model does not actually carry is not an assumption.
    if (!allOverridePaths.has(path) && !isAppliedValue(baseVal)) continue;
    built.push({ path, descriptor: assumptionFor(path, fieldByPath.get(path), baseVal, gridCtx) });
  }

  const groups: AssumptionGroup[] = groupAssumptionRows(built).map((g) => ({
    label: g.label,
    items: g.items.map((item) => ({
      label: item.grouped ? item.label : null,
      rows: item.rows.map((row) => {
        const p = row.path;
        const baseValue = getByPath(base, p);
        const notes = [
          inactiveLeverReason(p, base as never) ? 'not used under current settings' : '',
          leverNote(p) ?? '',
        ].filter(Boolean).join('. ');
        return {
          path: p,
          label: item.grouped ? (row.descriptor.context || row.descriptor.label) : row.descriptor.label,
          indented: item.grouped,
          note: notes,
          cells: columns.map((c) => {
            const ov = c.isBase ? {} : overridesOf(c.id);
            const has = Object.prototype.hasOwnProperty.call(ov, p);
            const value = has ? ov[p] : baseValue;
            return {
              caseId: c.id,
              text: `${formatAssumptionValue(value, row.descriptor.format)}${assumptionUnitSuffix(row.descriptor.format)}`,
              overridden: has && !c.isBase,
            };
          }),
        };
      }),
    })),
  }));

  return { columns, groups, emptyNote: ASSUMPTIONS_EMPTY_NOTE };
}
