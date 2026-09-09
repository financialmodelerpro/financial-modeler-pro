/**
 * consolidationCollisions.ts (2026-09-08, consolidation step 2a)
 *
 * WHERE THE MEMBERS OF A CONSOLIDATED LINE DISAGREE.
 *
 * READ ONLY, AND DELIBERATELY DECIDES NOTHING. Its output is the SPECIFICATION
 * for the merge rules, not the merge rules themselves. Every live group holds
 * exactly one asset, so the merge path has no real data and any rule written
 * now would be written from imagination; this finds the real disagreements a
 * fixture has to reproduce instead.
 *
 * A COLLISION IS NOT A FAULT. Two plots of one type legitimately differ on all
 * sorts of things. What matters is which differences a consolidated line CANNOT
 * carry two of, and that is what the severity says:
 *
 *   blocking   the line can hold only ONE answer and the members give two, so
 *              consolidating without a rule would silently pick one. Sub-unit
 *              metric is the clearest: a line cannot count units and area at
 *              once.
 *   summable   the difference disappears when the values are added, so there is
 *              nothing to decide. Land, areas, unit counts.
 *   review     the line can carry one answer and probably should, but which one
 *              is a judgement rather than arithmetic. Useful life, depreciation.
 *
 * Nothing imports this yet. Pure, no imports, no em dashes.
 */

export type CollisionSeverity = 'blocking' | 'review' | 'summable';

export interface CollisionField {
  /** Dotted path on the asset, as a person would say it. */
  field: string;
  severity: CollisionSeverity;
  /** One line saying why a line cannot simply hold both. */
  why: string;
  /** The distinct values found, as short strings, in member order. */
  values: { assetId: string; value: string }[];
}

export interface GroupCollisions {
  key: string;
  assetIds: string[];
  fields: CollisionField[];
  blocking: number;
  review: number;
}

/** The shape this needs. Structural, so core stays free of platform imports. */
export interface CollidableAsset {
  id: string;
  [field: string]: unknown;
}

/**
 * WHAT IS COMPARED, and at what severity.
 *
 * Ordered as a person would read it: the things that stop a merge, then the
 * things that need a decision. A field absent from this list is not compared,
 * which is why the list is data rather than a chain of ifs: adding one is a
 * line, and the verifier can enumerate it.
 */
export const COMPARED_FIELDS: { field: string; severity: CollisionSeverity; why: string }[] = [
  {
    field: 'subUnitMetric',
    severity: 'blocking',
    why: 'A line counts units OR area, never both: every sub-unit under it is read through this one setting.',
  },
  {
    field: 'strategy',
    severity: 'blocking',
    why: 'Strategy is part of the key, so members cannot differ. If they do, the grouping is wrong, not the data.',
  },
  {
    field: 'phaseId',
    severity: 'blocking',
    why: 'Phase is part of the key, for the same reason.',
  },
  {
    field: 'revenue.sell.recognitionProfile.method',
    severity: 'blocking',
    why: 'One line produces one revenue stream; two recognition methods would need two.',
  },
  {
    field: 'revenue.operate.startingADR',
    severity: 'review',
    why: 'An ADR per line. Two members with different rates need a weighted answer or a split.',
  },
  {
    field: 'revenue.lease.baseRate',
    severity: 'review',
    why: 'A rent per line, same as the ADR.',
  },
  {
    field: 'opex.defaultIndexation.method',
    severity: 'review',
    why: 'The line indexes its operating costs one way.',
  },
  {
    field: 'capexPhasing.phasing',
    severity: 'review',
    why: 'One construction curve per line; two members on different curves spend differently.',
  },
  {
    field: 'usefulLifeYears',
    severity: 'review',
    why: 'One depreciation life per line.',
  },
  {
    field: 'depreciationMethod',
    severity: 'review',
    why: 'One depreciation method per line.',
  },
  {
    field: 'managementAgreement.managementFeePct',
    severity: 'review',
    why: 'One management fee per line: two members on different fees would split the operator economics in two.',
  },
  {
    field: 'landChain.utilisationPct',
    severity: 'review',
    why: 'The area chain runs once per line, so its inputs have to agree or be re-derived from the pooled land.',
  },
  {
    field: 'landChain.coveragePct',
    severity: 'review',
    why: 'Ground coverage decides the footprint of the pooled land, so two answers give the line two footprints.',
  },
  {
    field: 'landChain.farRatio',
    severity: 'review',
    why: 'As above. Two FARs on one line means two different buildable areas.',
  },
  {
    field: 'landChain.retailPct',
    severity: 'review',
    why: 'The ground-floor retail share carves the same footprint two ways if the members disagree.',
  },
  {
    field: 'landChain.servicePct',
    severity: 'review',
    why: 'The service deduction sets net saleable, which is what every unit count and sale price hangs off.',
  },
  {
    field: 'revenue.sell.maxInstalmentYears',
    severity: 'review',
    why: 'One instalment window per line: two members would collect on two schedules.',
  },
  {
    field: 'revenue.sell.escrow.heldPctOverride',
    severity: 'review',
    why: 'One escrow treatment per line: escrow decides when cash is available, so two answers change the funding requirement.',
  },
  {
    field: 'revenue.sell.indexation.method',
    severity: 'review',
    why: 'One price escalation per line: two answers price the same cohort two ways.',
  },
  {
    field: 'managementAgreement.ownerRevenueSharePct',
    severity: 'review',
    why: 'The other half of the management split; it moves with the fee.',
  },
  {
    field: 'assetTypeId',
    severity: 'review',
    why: 'Members can reach the same type key from a registry pick and from free text. Not a fault, but the line has to record which identity it kept.',
  },
  {
    field: 'isCompanion',
    severity: 'blocking',
    why: 'A companion carries no land or cost of its own. Mixing one with a real asset in a line gives the line two natures.',
  },
];

/** Read a dotted path without throwing on a missing branch. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** A short, stable rendering of a value for a report. */
export function showValue(v: unknown): string {
  if (v === undefined) return '(not set)';
  if (v === null) return '(null)';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v.trim() === '' ? '(blank)' : v;
  return JSON.stringify(v).slice(0, 60);
}

/**
 * The disagreements inside ONE group.
 *
 * ABSENT AND SET ARE A DISAGREEMENT, deliberately. One member with a 25 year
 * life and one with none is exactly the case a merge rule has to decide, and
 * treating "not set" as "agrees with everything" would hide the commonest shape
 * of all. The blank-versus-zero rule this codebase already runs on says the
 * same thing: an absent value is an answer, not a wildcard.
 */
export function collisionsForGroup(
  key: string,
  members: readonly CollidableAsset[],
): GroupCollisions {
  const fields: CollisionField[] = [];
  if (members.length > 1) {
    for (const spec of COMPARED_FIELDS) {
      const seen = members.map((m) => ({ assetId: m.id, value: showValue(readPath(m, spec.field)) }));
      const distinct = new Set(seen.map((s) => s.value));
      if (distinct.size <= 1) continue;
      fields.push({ field: spec.field, severity: spec.severity, why: spec.why, values: seen });
    }
  }
  return {
    key,
    assetIds: members.map((m) => m.id),
    fields,
    blocking: fields.filter((f) => f.severity === 'blocking').length,
    review: fields.filter((f) => f.severity === 'review').length,
  };
}

/** Every group's collisions, groups of one included so a caller can show that
 *  they were checked and found clean rather than skipped. */
export function collisionsForGroups(
  groups: readonly { key: string; assets: readonly CollidableAsset[] }[],
): GroupCollisions[] {
  return groups.map((g) => collisionsForGroup(g.key, g.assets));
}
