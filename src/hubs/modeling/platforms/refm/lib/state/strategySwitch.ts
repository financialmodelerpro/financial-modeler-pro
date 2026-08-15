/**
 * strategySwitch.ts (M1 Assets, 2026-08-11)
 *
 * Changing an asset's strategy is a MODEL operation, not a field write.
 *
 * WHAT WAS WRONG. The Strategy dropdown wrote one field and nothing else. The
 * engine gates on `asset.strategy` in every resolver, so the moment the field
 * changed the old strategy's assumptions stopped feeding the model, and the new
 * strategy's assumptions did not start, because they did not exist:
 *
 *   - `asset.revenue` is already partitioned (.sell / .operate / .lease), and
 *     an asset built as Sell carries only `.sell`, so an Operate resolver read
 *     `undefined`.
 *   - SUB-UNITS are not partitioned at all. Each carries ONE category, so a
 *     Sell asset switched to Operate kept its `Sellable` rows and the Operate
 *     resolver counted ZERO keys. Even a seeded revenue config would have
 *     produced nothing.
 *   - `asset.opex.lines` is one flat list shared by every strategy, so an
 *     Operate asset moved to Lease kept its hospitality opex lines.
 *   - Leaving `Sell + Manage` HARD DELETED the companion asset, its sub-units,
 *     its cost lines and its cost overrides. That is the one strategy whose
 *     assumptions did not survive a round trip at all.
 *
 * Measured on the reference project: every strategy change dropped the asset's
 * revenue to zero with no warning (a Sell asset worth 2,822m of revenue moved
 * to Operate took project revenue from 14,055.0m to 11,233.0m), and
 * Sell <-> Sell + Manage was a model no-op.
 *
 * THE DESIGN. Assumption sets are parked and restored, never deleted, so a user
 * can build the model once and then test strategies on the same asset.
 *
 * RETENTION IS OFF TO ONE SIDE, not a filter over the live arrays. The outgoing
 * strategy's sub-units, opex and companion move into `asset.retainedByStrategy`
 * and the incoming strategy's move back out. `state.subUnits`, `state.costLines`
 * and `state.costOverrides` therefore contain EXACTLY what they contain today:
 * only the active strategy's rows. That matters because roughly forty engine
 * and UI call sites read `state.subUnits` directly, and a design that left
 * inactive rows in place would need every one of them to filter correctly
 * forever. This one needs none of them to change.
 *
 * FIRST VISIT SEEDS FROM THE OUTGOING SET. Counts, areas and names carry over
 * so the new strategy is not empty; the RATE does not, because a sale price is
 * not an ADR and is not a lease rate. What is left blank is reported so the UI
 * can tell the user exactly what to go and fill in.
 *
 * PURE: state in, state out, plus a report. No store, no React, no I/O.
 *
 * No em dashes in this file.
 */
import {
  makeCompanionAsset,
  type Asset,
  type AssetStrategy,
  type CostLine,
  type CostOverride,
  type SubUnit,
  type SubUnitCategory,
} from './module1-types';

/** The sub-unit category a strategy's revenue is measured in. Support rows are
 *  auxiliary (parking, back of house) and belong to no strategy, so they are
 *  carried across every switch untouched. */
export const CATEGORY_BY_STRATEGY: Record<AssetStrategy, SubUnitCategory> = {
  'Sell': 'Sellable',
  'Sell + Manage': 'Sellable',
  'Operate': 'Operable',
  'Lease': 'Leasable',
};

/** The `asset.revenue` sub-config a strategy reads. Sell + Manage uses the Sell
 *  config on the parent; its operating side lives on the companion asset. */
export const REVENUE_KEY_BY_STRATEGY: Record<AssetStrategy, 'sell' | 'operate' | 'lease'> = {
  'Sell': 'sell',
  'Sell + Manage': 'sell',
  'Operate': 'operate',
  'Lease': 'lease',
};

/** One strategy's parked assumptions. Everything here is inert until that
 *  strategy is selected again, at which point it is restored verbatim. */
export interface RetainedStrategyAssumptions {
  subUnits?: SubUnit[];
  opex?: Asset['opex'];
  /** Only ever present for 'Sell + Manage'. */
  companion?: {
    asset: Asset;
    subUnits: SubUnit[];
    costLines: CostLine[];
    costOverrides: CostOverride[];
  };
}

/** What a switch did, in the user's terms. The UI shows this twice: once in the
 *  confirmation before the change, once as a banner that stays until the empty
 *  assumptions are filled in. */
export interface StrategySwitchReport {
  assetId: string;
  assetName: string;
  from: AssetStrategy;
  to: AssetStrategy;
  /** Parked, still on the asset, restored if the user switches back. */
  retained: string[];
  /** Came back from a previous visit to this strategy, unchanged. */
  restored: string[];
  /** Created fresh from the outgoing set (counts and areas carried over). */
  seeded: string[];
  /** Active but empty. These are what the user has to go and fill in. */
  needsReview: string[];
}

export interface StrategySwitchState {
  assets: Asset[];
  subUnits: SubUnit[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
}

export interface StrategySwitchResult extends StrategySwitchState {
  report: StrategySwitchReport;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Sub-units that belong to a strategy (its own category). Support rows are
 *  excluded here and never move. */
const strategyRows = (rows: SubUnit[], strategy: AssetStrategy): SubUnit[] =>
  rows.filter((u) => u.category === CATEGORY_BY_STRATEGY[strategy]);

const supportRows = (rows: SubUnit[]): SubUnit[] => rows.filter((u) => u.category === 'Support');

/**
 * Seed the incoming strategy's sub-units from the outgoing ones: same rows,
 * same counts, same areas, RE-CATEGORISED, with the rate cleared.
 *
 * The rate is deliberately dropped. Carrying a 1,000,000 per-unit sale price
 * across to an Operate asset would present it as an ADR of 1,000,000 a night,
 * which is worse than blank because it looks like an answer.
 */
function seedRows(from: SubUnit[], to: AssetStrategy): SubUnit[] {
  const category = CATEGORY_BY_STRATEGY[to];
  return from.map((u, i) => ({
    ...clone(u),
    id: `${u.id}__${to.replace(/[^a-z]/gi, '')}_${i}`,
    category,
    unitPrice: 0,
    startingAdr: to === 'Operate' ? 0 : undefined,
    occupancyPct: to === 'Operate' || to === 'Lease' ? (u.occupancyPct ?? 0) : undefined,
    // Companion linkage never survives a re-seed: it is rebuilt by the
    // companion sync when Sell + Manage is next selected.
    parentSubUnitId: undefined,
  }));
}

/** True when a strategy's ACTIVE sub-units carry no usable rate, which is what
 *  makes a newly activated strategy compute to zero. */
function ratesAreBlank(rows: SubUnit[], strategy: AssetStrategy): boolean {
  const own = strategyRows(rows, strategy);
  if (own.length === 0) return true;
  if (strategy === 'Operate') return own.every((u) => !(u.startingAdr ?? u.unitPrice ?? 0));
  return own.every((u) => !(u.unitPrice ?? 0));
}

/**
 * Apply a strategy change to the whole M1 slice.
 *
 * Returns the state unchanged (with an empty report) when the strategy is not
 * actually changing or the asset does not exist, so a caller can invoke it
 * without guarding.
 */
export function applyStrategySwitch(
  state: StrategySwitchState,
  assetId: string,
  to: AssetStrategy,
): StrategySwitchResult {
  const asset = state.assets.find((a) => a.id === assetId);
  const empty = (from: AssetStrategy): StrategySwitchResult => ({
    ...state,
    report: { assetId, assetName: asset?.name ?? '', from, to, retained: [], restored: [], seeded: [], needsReview: [] },
  });
  if (!asset || asset.isCompanion === true) return empty(asset?.strategy ?? to);
  const from = asset.strategy;
  if (from === to) return empty(from);

  const report: StrategySwitchReport = {
    assetId, assetName: asset.name, from, to,
    retained: [], restored: [], seeded: [], needsReview: [],
  };

  // ── 1. Park everything that belongs to the OUTGOING strategy ───────────────
  const bank: Partial<Record<AssetStrategy, RetainedStrategyAssumptions>> = { ...(asset.retainedByStrategy ?? {}) };
  const outgoing: RetainedStrategyAssumptions = {};

  const ownRows = strategyRows(state.subUnits.filter((u) => u.assetId === assetId), from);
  if (ownRows.length) {
    outgoing.subUnits = clone(ownRows);
    report.retained.push(`${ownRows.length} ${CATEGORY_BY_STRATEGY[from]} sub-unit${ownRows.length === 1 ? '' : 's'}`);
  }
  if (asset.opex?.lines?.length) {
    outgoing.opex = clone(asset.opex);
    report.retained.push(`${asset.opex.lines.length} opex line${asset.opex.lines.length === 1 ? '' : 's'}`);
  }

  // The companion is the whole reason this function exists rather than a patch:
  // leaving Sell + Manage used to delete it outright.
  const companionIds = new Set(state.assets.filter((a) => a.parentAssetId === assetId).map((a) => a.id));
  if (from === 'Sell + Manage' && companionIds.size > 0) {
    const cAsset = state.assets.find((a) => companionIds.has(a.id))!;
    outgoing.companion = clone({
      asset: cAsset,
      subUnits: state.subUnits.filter((u) => companionIds.has(u.assetId)),
      costLines: state.costLines.filter((c) => c.targetAssetId && companionIds.has(c.targetAssetId)),
      costOverrides: state.costOverrides.filter((o) => companionIds.has(o.assetId)),
    });
    report.retained.push(`the "${cAsset.name}" companion, with its sub-units, cost lines and overrides`);
  }
  if (Object.keys(outgoing).length > 0) bank[from] = outgoing;

  // ── 2. Bring back (or seed) everything the INCOMING strategy needs ─────────
  const incoming = bank[to];
  const keep = state.subUnits.filter((u) => u.assetId !== assetId || u.category === 'Support');
  let nextSubUnits: SubUnit[];

  if (incoming?.subUnits?.length) {
    nextSubUnits = [...keep, ...clone(incoming.subUnits)];
    report.restored.push(`${incoming.subUnits.length} ${CATEGORY_BY_STRATEGY[to]} sub-unit${incoming.subUnits.length === 1 ? '' : 's'} from the last time this asset was ${to}`);
  } else if (ownRows.length) {
    const seeded = seedRows(ownRows, to);
    nextSubUnits = [...keep, ...seeded];
    report.seeded.push(`${seeded.length} ${CATEGORY_BY_STRATEGY[to]} sub-unit${seeded.length === 1 ? '' : 's'}, with the counts and areas carried over`);
  } else {
    nextSubUnits = keep;
  }
  // Support rows never move, so say so only when there are any to reassure.
  const support = supportRows(state.subUnits.filter((u) => u.assetId === assetId));
  if (support.length) report.retained.push(`${support.length} Support sub-unit${support.length === 1 ? '' : 's'} (not strategy specific)`);

  const nextOpex = incoming?.opex ? clone(incoming.opex) : undefined;
  if (incoming?.opex?.lines?.length) {
    report.restored.push(`${incoming.opex.lines.length} opex line${incoming.opex.lines.length === 1 ? '' : 's'} from the last time this asset was ${to}`);
  }

  // ── 3. Companion lifecycle ────────────────────────────────────────────────
  let nextAssets = state.assets.filter((a) => !companionIds.has(a.id));
  let nextCostLines = state.costLines.filter((c) => !c.targetAssetId || !companionIds.has(c.targetAssetId));
  let nextCostOverrides = state.costOverrides.filter((o) => !companionIds.has(o.assetId));
  nextSubUnits = nextSubUnits.filter((u) => !companionIds.has(u.assetId));

  const patched: Asset = {
    ...asset,
    strategy: to,
    retainedByStrategy: Object.keys(bank).length ? bank : undefined,
    opex: nextOpex,
  };
  // Delete the parked copy of the strategy now becoming active, so the bank
  // never holds a stale duplicate of the live set.
  if (patched.retainedByStrategy) {
    const b = { ...patched.retainedByStrategy };
    delete b[to];
    patched.retainedByStrategy = Object.keys(b).length ? b : undefined;
  }
  nextAssets = nextAssets.map((a) => (a.id === assetId ? patched : a));

  if (to === 'Sell + Manage') {
    const restored = incoming?.companion;
    if (restored) {
      nextAssets = [...nextAssets, clone(restored.asset)];
      nextSubUnits = [...nextSubUnits, ...clone(restored.subUnits)];
      nextCostLines = [...nextCostLines, ...clone(restored.costLines)];
      nextCostOverrides = [...nextCostOverrides, ...clone(restored.costOverrides)];
      report.restored.push(`the "${restored.asset.name}" companion, exactly as it was`);
    } else {
      const sellable = nextSubUnits
        .filter((u) => u.assetId === assetId && u.category === 'Sellable')
        .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
      const companion = makeCompanionAsset(patched, sellable);
      nextAssets = [...nextAssets, companion];
      report.seeded.push(`the "${companion.name}" companion asset, which carries the operating side`);
      report.needsReview.push(`ADR and occupancy on "${companion.name}" (Module 2, Revenue)`);
    }
  }

  // ── 4. What is now active but empty ───────────────────────────────────────
  const revKey = REVENUE_KEY_BY_STRATEGY[to];
  if (!asset.revenue?.[revKey]) {
    report.needsReview.push(to === 'Lease'
      ? 'Lease revenue configuration: lease rate, vacancy and escalation (Module 2, Revenue)'
      : to === 'Operate'
        ? 'Operate revenue configuration: ADR indexation, occupancy ramp, F&B and other revenue (Module 2, Revenue)'
        : 'Sell revenue configuration: sales velocity, cash payment profile and revenue recognition (Module 2, Revenue)');
  }
  if (ratesAreBlank(nextSubUnits.filter((u) => u.assetId === assetId), to)) {
    report.needsReview.push(to === 'Operate'
      ? 'ADR per sub-unit (Module 1, Assets and Sub-units)'
      : to === 'Lease'
        ? 'Lease rate per sub-unit (Module 1, Assets and Sub-units)'
        : 'Unit price per sub-unit (Module 1, Assets and Sub-units)');
  }
  if ((to === 'Operate' || to === 'Lease') && !nextOpex?.lines?.length) {
    report.needsReview.push('Operating cost lines (Module 3, Operating Expenses). Strategy defaults apply until you set them.');
  }
  if ((to === 'Operate' || to === 'Lease') && !patched.usefulLifeYears) {
    report.needsReview.push('Useful life for depreciation (Module 1, Assets). A default applies until you set it.');
  }

  return { assets: nextAssets, subUnits: nextSubUnits, costLines: nextCostLines, costOverrides: nextCostOverrides, report };
}

/** True when a report has anything the user must act on. */
export function switchNeedsReview(report: StrategySwitchReport | null | undefined): boolean {
  return !!report && report.needsReview.length > 0;
}

/**
 * Does this asset carry assumptions that a strategy change can disturb?
 * (2026-08-15)
 *
 * WHY THIS IS SEPARATE FROM THE REPORT. `needsReview` answers "what is now
 * active but empty", and on a brand-new asset the answer is "everything",
 * because nothing has been entered yet. So the confirmation dialog and the
 * review banner fired hardest in the one case where there was nothing to
 * review: a user adds an asset (which is created as `Sell`, the default) and
 * picks its real strategy from the dropdown for the first time. That is a first
 * SELECTION, not a change, and it was being announced as a model operation with
 * a four-item list of things to go and fill in.
 *
 * This predicate is the gate. It reads the state BEFORE the switch and asks
 * whether the user has actually built anything on this asset yet:
 *
 *   - sub-units of any category, including Support
 *   - opex lines
 *   - any revenue configuration (sell / operate / lease)
 *   - assumptions already parked by an earlier switch
 *   - a companion asset (only Sell + Manage has one)
 *   - cost overrides, or cost lines targeted at this asset specifically
 *
 * Useful life is deliberately NOT in the list: it is not strategy scoped and
 * survives every switch untouched, so it is never a reason to warn.
 *
 * Pure, and shared by the store and the dropdown so the dialog and the banner
 * cannot disagree about whether a switch was worth announcing.
 */
export function assetHasStrategyAssumptions(
  state: StrategySwitchState,
  assetId: string,
): boolean {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) return false;
  if (state.subUnits.some((u) => u.assetId === assetId)) return true;
  if (asset.opex?.lines?.length) return true;
  const rev = asset.revenue;
  if (rev && (rev.sell || rev.operate || rev.lease)) return true;
  if (asset.retainedByStrategy && Object.keys(asset.retainedByStrategy).length > 0) return true;
  if (state.assets.some((a) => a.parentAssetId === assetId)) return true;
  if (state.costOverrides.some((o) => o.assetId === assetId)) return true;
  if (state.costLines.some((c) => c.targetAssetId === assetId)) return true;
  return false;
}
