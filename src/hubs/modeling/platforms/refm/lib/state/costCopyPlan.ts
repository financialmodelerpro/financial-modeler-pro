/**
 * costCopyPlan.ts (2026-08-17)
 *
 * Copying one asset's cost configuration onto another, as a PURE PLAN.
 *
 * WHY IT IS A MODULE AND NOT AN onClick. This logic lived inline in a JSX click
 * handler, so nothing could test it: the only checks possible were greps for
 * source strings, which is how "copy reproduces the line set" could be asserted
 * while the live project still did not. A plan that can be computed can be
 * compared against a real project's line sets.
 *
 * WHAT COPYING MEANS. Cost lines belong to a PHASE, not to an asset, so making
 * a target asset match a source asset means two different things:
 *   - same phase: the line set is already identical by construction, and only
 *     the per-asset values (the overrides) are copied.
 *   - other phase: the target phase's LINE SET is reconciled to the source's,
 *     which changes that phase for every asset in it. The caller says so.
 *
 * MATCHING IS BY CATALOG IDENTITY PLUS OCCURRENCE, never by display name. A
 * renamed line has no name twin in the target phase, which is exactly why the
 * previous name match skipped it silently. Occurrence matters because two lines
 * may legitimately share one entry (a "Launch campaign" and an "Ongoing
 * marketing", both Marketing), and matching on identity alone maps both onto
 * the target's first one.
 *
 * ONE VISIBILITY RULE ON BOTH SIDES. `assetVisibleLines` decides what the
 * source offers AND what the target is considered to have. Measured on a live
 * project when the two disagreed: the source list dropped country-gated lines
 * while the target list counted them, so a hidden `rett__phase_2` matched the
 * user's own RETT line, no line was created, and the override was written onto
 * a row the user cannot see. The copy reported success and the visible table
 * did not change. (The country gate itself was retired on 2026-08-17c, which
 * is why the rule no longer takes a country: nothing is hidden any more. The
 * lesson stands: both sides must ask the same question.)
 *
 * Pure. No em dashes in this file.
 */

import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import { resolveCatalogId, mintLineId } from './costCatalog';
import { deriveLineBaseId, type CostLine } from './module1-types';

/** The identity two lines are matched on: the catalog entry, falling back to a
 *  normalised name for a genuine one-off. */
export function copyIdentityOf(line: CostLine): string {
  return resolveCatalogId(line) ?? `name:${line.name.trim().toLowerCase()}`;
}

/** Identity plus how many lines with that identity came before it. */
export function occurrenceKeys(lines: readonly CostLine[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const c of lines) {
    const base = copyIdentityOf(c);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(c.id, `${base}#${n}`);
  }
  return out;
}

export interface CostCopyPlanInput {
  /** Every cost line in the project. */
  costLines: CostLine[];
  sourcePhaseId: string;
  sourceAssetId: string;
  /** Phase ids of the selected targets, source phase excluded by the caller or
   *  here (it is filtered either way). */
  targetPhaseIds: string[];
  /** Remove target-phase lines the source does not have. Off by default because
   *  it reaches every asset in that phase. */
  removeExtra: boolean;
}

export interface CostCopyPhasePlan {
  phaseId: string;
  /** Source lines with no counterpart in this phase: they get created. */
  toCreate: CostLine[];
  /** Lines in this phase the source does not have. */
  extra: CostLine[];
  /** sourceLineId -> the id it maps to in this phase (existing or minted). */
  mapping: Map<string, string>;
}

export interface CostCopyPlan {
  sourceLines: CostLine[];
  phases: CostCopyPhasePlan[];
  /** The full costLines array after the reconciliation, ready for setCostLines.
   *  Identical to the input array when nothing needs creating or removing. */
  nextCostLines: CostLine[];
  created: number;
  removed: number;
  /** Source lines that reach no counterpart in some target phase. Should be
   *  zero: it is reported so a silent skip can never come back. */
  unmatched: number;
}

/**
 * Build the plan. Pure: it computes the next `costLines` array and the id
 * mapping, and writes nothing.
 */
export function planCostCopy(input: CostCopyPlanInput): CostCopyPlan {
  const { costLines, sourcePhaseId, sourceAssetId, removeExtra } = input;
  const sourceLines = assetVisibleLines(costLines, sourcePhaseId, sourceAssetId);
  const sourceKeyById = occurrenceKeys(sourceLines);
  const sourceKeys = new Set(sourceKeyById.values());
  const targetPhaseIds = input.targetPhaseIds.filter((p) => p !== sourcePhaseId);

  let next = [...costLines];
  const phases: CostCopyPhasePlan[] = [];
  let created = 0;
  let removed = 0;

  for (const phaseId of targetPhaseIds) {
    // THE SAME VISIBILITY RULE AS THE SOURCE. A line the user cannot see must
    // not count as the target already having that identity.
    const existing = assetVisibleLines(next, phaseId, undefined);
    const targetKeyById = occurrenceKeys(existing);
    const targetKeys = new Set(targetKeyById.values());

    const toCreate = sourceLines.filter((c) => !targetKeys.has(sourceKeyById.get(c.id)!));
    const extra = existing.filter((c) => !sourceKeys.has(targetKeyById.get(c.id)!) && !isParcelLand(c));

    if (removeExtra && extra.length > 0) {
      const drop = new Set(extra.map((c) => c.id));
      next = next.filter((c) => !drop.has(c.id));
      removed += extra.length;
    }

    const mapping = new Map<string, string>();
    // Existing matches first, so a created line never steals a match.
    for (const src of sourceLines) {
      const key = sourceKeyById.get(src.id)!;
      const match = existing.find((c) => targetKeyById.get(c.id) === key);
      if (match && !(removeExtra && extra.some((e) => e.id === match.id))) mapping.set(src.id, match.id);
    }
    for (const src of toCreate) {
      const id = mintLineId(
        resolveCatalogId(src) ?? deriveLineBaseId(src.id),
        phaseId,
        next.map((c) => c.id),
      );
      mapping.set(src.id, id);
      const clone: CostLine = {
        ...src,
        id,
        phaseId,
        // A line targeted at the source asset becomes project-wide in the new
        // phase: the target is a different asset.
        targetAssetId: undefined,
        distribution: src.distribution ? [...src.distribution] : undefined,
        perSubUnitRates: src.perSubUnitRates ? { ...src.perSubUnitRates } : undefined,
        selectedLineIds: undefined, // remapped below, once every id exists
      };
      const lastIdx = next.map((c) => c.phaseId).lastIndexOf(phaseId);
      next.splice(lastIdx < 0 ? next.length : lastIdx + 1, 0, clone);
      created += 1;
    }
    phases.push({ phaseId, toCreate, extra, mapping });
  }

  // Remap every selection into each target phase, once every id exists. A
  // source id means nothing in another phase, so an unremapped selection would
  // silently charge on nothing.
  for (const plan of phases) {
    const phaseKeyById = occurrenceKeys(next.filter((c) => c.phaseId === plan.phaseId));
    next = next.map((c) => {
      if (c.phaseId !== plan.phaseId) return c;
      const srcId = [...plan.mapping.entries()].find(([, id]) => id === c.id)?.[0];
      if (!srcId) return c;
      const src = sourceLines.find((s) => s.id === srcId);
      if (!src?.selectedLineIds?.length) return c;
      const remapped = src.selectedLineIds
        .map((refId) => {
          const wantedKey = sourceKeyById.get(refId);
          if (!wantedKey) return undefined;
          for (const [id, key] of phaseKeyById) if (key === wantedKey) return id;
          return undefined;
        })
        .filter((v): v is string => !!v);
      return remapped.length > 0 ? { ...c, selectedLineIds: remapped } : c;
    });
  }

  const unmatched = phases.reduce(
    (s, p) => s + sourceLines.filter((c) => !p.mapping.has(c.id)).length,
    0,
  );

  return { sourceLines, phases, nextCostLines: next, created, removed, unmatched };
}

/** The two parcel-driven land rows are derivations and are never removed as
 *  "extra". Kept local to avoid importing the engine into the state layer for
 *  one predicate. */
function isParcelLand(line: CostLine): boolean {
  const base = deriveLineBaseId(line.id);
  return base === 'land-cash' || base === 'land-inkind';
}
