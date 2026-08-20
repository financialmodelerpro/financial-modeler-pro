/**
 * saleCohortResolution.ts (2026-08-20, Option B Step 2)
 *
 * WHERE A SALE COHORT'S DOWNPAYMENT COMES FROM, resolved once and shared.
 *
 * There are four answers and a user must always be able to see which one is in
 * force, so this returns the reason alongside the number rather than leaving
 * the screen to guess a badge that could eventually disagree with the model.
 *
 *   1. set              typed for this sale year on this asset
 *   2. carried          not typed for this year, carried forward from the last
 *                       year on THIS asset that was
 *   3. project default  this asset has no downpayment on any sale year, so the
 *                       project-wide default stands in
 *   4. not set          neither, so the cohort has no stated deposit at all
 *
 * ── THE ASSET WINS PER ASSET, NOT PER YEAR ───────────────────────────────────
 *
 * An asset holding a downpayment on ANY sale year governs EVERY one of its
 * years through its own forward fill, and the project default is never
 * consulted for it. Filling individual blank years from the project would
 * interleave two sources inside one strip, and a reader going across a row
 * would be reading alternating answers. `hasAnyDownpayment` is the predicate,
 * and it is shared with the engine so the two cannot disagree.
 *
 * ── WHY IT USES THE SHARED INHERITANCE PRIMITIVE ─────────────────────────────
 *
 * `inheritance.ts` is the one own -> derived -> group -> fallback mechanism in
 * this codebase, and this is a straight own/group/fallback question, so it gets
 * used rather than becoming a fourth hand-written chain.
 *
 * ONE ADAPTATION, and it is deliberate. That primitive's `fallback` is typed as
 * always present, so "resolution can never fail". Here it must be able to fail:
 * a cohort with no downpayment anywhere is BLOCKED, and that is the whole point
 * of the step. So `T` is `number | undefined` and `fallback: undefined` is a
 * legitimate value of T rather than a lie about the contract. `kind` of
 * `fallback` with an undefined value is the blocked state.
 *
 * ── STEP 2 SCOPE ─────────────────────────────────────────────────────────────
 *
 * Resolution and display only. A BLOCKED asset behaves exactly as it does
 * today, computing from a zero deposit, because Step 3 is where blocking
 * surfaces in the reconciliation warnings and the checks report. That is what
 * makes Step 2 provably inert on a project with no default set.
 *
 * No em dashes in this file.
 */

import { resolveDownpayment, hasAnyDownpayment, type DownpaymentEntry } from '@/src/core/calculations/revenue/cohortTerms';
import { resolveInheritance } from './inheritance';

/** Which of the four answers is in force for one sale year. */
export type DownpaymentSourceKind = 'set' | 'carried' | 'project_default' | 'not_set';

export interface ResolvedCohortDownpayment {
  /** The fraction to use. Zero when nothing resolves, which at Step 2 is the
   *  same number the engine already produced for such an asset. */
  value: number;
  kind: DownpaymentSourceKind;
  /** Short token for a table cell: set / carried / project default / not set. */
  label: string;
  /** One sentence naming where it came from, for a caption or a tooltip. */
  reason: string;
}

/** Whether an ASSET takes its own terms, the project default, or neither. This
 *  is decided once for the asset and then applies to all of its sale years. */
export interface AssetDownpaymentSource {
  kind: 'own' | 'project_default' | 'not_set';
  /** The project default in force, when kind is 'project_default'. */
  projectDefault?: number;
  reason: string;
}

const LABELS: Record<DownpaymentSourceKind, string> = {
  set: 'set',
  carried: 'carried',
  project_default: 'project default',
  not_set: 'not set',
};

/**
 * The per-asset decision. Uses the shared inheritance primitive so the wording
 * and the precedence come from the same place as every other inherit-and-
 * override in the platform.
 */
export function resolveAssetDownpaymentSource(
  assetValues: ReadonlyArray<DownpaymentEntry> | undefined,
  projectDefault: number | undefined,
): AssetDownpaymentSource {
  const ownsIt = hasAnyDownpayment(assetValues);
  const res = resolveInheritance<number | undefined>({
    mode: ownsIt ? 'own' : 'inherit',
    // The per-year value comes from the forward fill below; what matters here
    // is only THAT the asset has one, so any defined marker does.
    own: ownsIt ? 1 : undefined,
    group: projectDefault,
    fallback: undefined,
    groupLabel: 'the project default downpayment',
  });

  if (res.kind === 'own') {
    return { kind: 'own', reason: 'This asset has its own downpayment terms, so the project default does not apply to it.' };
  }
  if (res.kind === 'group' && res.value !== undefined) {
    return {
      kind: 'project_default',
      projectDefault: res.value,
      reason: `This asset has no downpayment of its own, so it uses the project default of ${(res.value * 100).toFixed(2)}%.`,
    };
  }
  return {
    kind: 'not_set',
    reason: 'No downpayment is set on this asset and no project default is set, so no deposit has been stated for these cohorts.',
  };
}

/**
 * The value and its source for ONE sale year, by phase-local index.
 *
 * `set` and `carried` are the asset's own two answers and come from the shared
 * forward-fill rule in core, so the screen and the engine cannot disagree about
 * which year carries which.
 */
export function resolveCohortDownpayment(
  assetValues: ReadonlyArray<DownpaymentEntry> | undefined,
  projectDefault: number | undefined,
  index: number,
): ResolvedCohortDownpayment {
  const source = resolveAssetDownpaymentSource(assetValues, projectDefault);

  if (source.kind === 'own') {
    const own = resolveDownpayment(assetValues, index);
    const kind: DownpaymentSourceKind = own.source === 'set' ? 'set' : 'carried';
    return {
      value: own.value,
      kind,
      label: LABELS[kind],
      reason: kind === 'set'
        ? 'Typed for this sale year.'
        : 'Not typed for this year, so it carries the last sale year you set on this asset.',
    };
  }
  if (source.kind === 'project_default') {
    return {
      value: source.projectDefault ?? 0,
      kind: 'project_default',
      label: LABELS.project_default,
      reason: source.reason,
    };
  }
  return { value: 0, kind: 'not_set', label: LABELS.not_set, reason: source.reason };
}

/**
 * The project-axis array the engine consumes, with the project default already
 * applied where an asset has nothing of its own.
 *
 * Returns undefined when there is nothing to say, which leaves the engine on
 * exactly the path it took before this existed. That is what makes Step 2
 * inert on a project with no default set.
 */
export function buildEngineDownpaymentAxis(
  assetValues: ReadonlyArray<DownpaymentEntry> | undefined,
  projectDefault: number | undefined,
  phaseOffset: number,
  axisLength: number,
): Array<number | null> | undefined {
  const source = resolveAssetDownpaymentSource(assetValues, projectDefault);

  if (source.kind === 'own') {
    if (!Array.isArray(assetValues)) return undefined;
    const axis = new Array<number | null>(axisLength).fill(null);
    for (let k = 0; k < assetValues.length; k++) {
      const idx = phaseOffset + k;
      const v = assetValues[k];
      if (idx >= 0 && idx < axisLength) {
        axis[idx] = typeof v === 'number' && Number.isFinite(v) ? v : null;
      }
    }
    return axis;
  }

  if (source.kind === 'project_default') {
    // ONE entry at the phase start is enough: the forward fill in core carries
    // it across every later sale year, which is the same rule the asset's own
    // values use, so there is no second definition of "applies from here on".
    const axis = new Array<number | null>(axisLength).fill(null);
    const idx = Math.max(0, Math.min(axisLength - 1, phaseOffset));
    axis[idx] = source.projectDefault ?? 0;
    return axis;
  }

  // BLOCKED. Deliberately unchanged at Step 2: the engine gets nothing, so
  // every cohort resolves to a zero deposit exactly as it did before, and
  // Step 3 is what makes the absence visible. An all-null array and no array
  // resolve identically in core, so there is nothing to distinguish here.
  return undefined;
}
