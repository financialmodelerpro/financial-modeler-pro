/**
 * capexReports.ts
 *
 * Shared pure builder for the Module 1 Capex tab (Input cost lines per asset +
 * the "Results" output tables), so the PDF export mirrors the platform and
 * stays in sync. Recomputes the per-asset cost breakdown with the SAME engine
 * call the financials resolver uses (computeAssetCost + project.financing
 * .parcelFunding) and projects each per-period series onto the project axis with
 * the SAME offset rule (capex.ts), so the per-asset rows reconcile to the
 * project capex totals on the snapshot.
 *
 * Pure: reads the financials snapshot + project state only; no engine mutation.
 */
import { computeAssetCost, deriveCostStage, resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import { collectionsForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { assetLabel } from '@/src/core/calculations/assetName';
import { groupAssetsForConsolidation } from '@/src/core/calculations/consolidation';
import { retailCompanionId } from '@/src/core/calculations/retailCompanion';
import { normaliseAssetTypeId } from '@/src/core/calculations/typeKey';
import { withInheritedMassingAll } from '@/src/core/calculations/landChain';
import { chainMassingFor } from '../state/assetTypeStandards';

export type MetricKind = 'area' | 'count' | 'money' | 'none';

export interface CapexInputLine {
  /** Cost-line id (phase-scoped). Lets the Excel build-up map each line to its
   *  amount cell so percent_of_selected can reference the right sibling rows. */
  id: string;
  /** Raw cost method, so the Excel build-up can pick the live-basis source. */
  method: string;
  /** For percent_of_selected: the sibling line ids whose totals are the base. */
  selectedLineIds: string[];
  name: string;
  stage: string;
  basis: string;
  /** Rate or fixed value the user entered. */
  rate: number;
  isFixed: boolean;
  /** True for percent-of-* methods (rate is a percentage). */
  isPercent: boolean;
  /** The basis the rate/percentage multiplies: a quantity (BUA/NSA/land sqm,
   *  units, bays) for rate lines, or the reference amount (revenue, land value,
   *  construction total, selected-lines total) for percent lines. */
  metricValue: number | null;
  metricLabel: string;
  metricKind: MetricKind;
  /** Engine-computed amount for this line on this asset. */
  amount: number;
  /** Per-line capex distribution projected onto the project axis (length N).
   *  Σ over the axis equals `amount`; Σ across an asset's lines equals the
   *  asset perPeriod. Seeds the Excel per-line year-on-year phasing matrix. */
  perPeriod: number[];
  /** Effective phasing window + method for this line on this asset (master line
   *  merged with any active per-asset override). startPeriod / endPeriod are
   *  phase-relative period indices; phasing is 'even' or 'manual'. Seeds the
   *  Inputs cost-line table so a user sees when each line spends and how. */
  startPeriod: number;
  endPeriod: number;
  phasing: string;
  /** Effective per-sub-unit custom rates, only when method is
   *  'per_sub_unit_custom_rates'. Keys are sub-unit ids plus the special
   *  '__support__' / '__parking__' rows. Lets the Inputs tab show the rate
   *  sheet that a single Rate cell would otherwise collapse to one number. */
  perSubUnitRates?: Record<string, number>;
}
/**
 * Hard / soft / land subtotals for one asset (2026-08-15).
 *
 * The classification was never missing from the DATA: `CostStage`,
 * `deriveCostStage` and the engine's `byStage` have carried it throughout, and
 * the per-line stage already reached the PDF capex table and the Excel Inputs
 * tab as a column. What was missing was any AGGREGATION in the shared report
 * layer: `lib/reports/` contained no reference to hard or soft anywhere, so no
 * export could show a subtotal. A development cost summary that cannot separate
 * hard from soft is not usable for a lender or an investment committee, which
 * is the whole point of the split.
 *
 * Stage comes from `deriveCostStage`, the same resolver the screen tiles and
 * the engine use, so a standard line's stage cannot read one way here and
 * another way there.
 */
export interface CapexStageSubtotals {
  land: number;
  hard: number;
  soft: number;
  /** 2026-08-16: selling cost, reported separately because it is not part of
   *  the construction cost even though the developer fee and contingency are
   *  charged on it. */
  marketing: number;
  operating: number;
  /**
   * Hard + soft + operating. The figure a lender means by "development cost",
   * and it EXCLUDES marketing as well as land (2026-08-16). A reference budget
   * totals construction cost excluding land as hard cost plus engineering,
   * design, permits, developer fee and contingency, with marketing outside it.
   */
  exclLand: number;
  /** Everything: land, construction and marketing. */
  total: number;
}

export interface CapexInputAsset {
  assetId: string;
  assetName: string;
  phaseName: string;
  lines: CapexInputLine[];
  total: number;
  /** Per-asset hard / soft split. */
  subtotals: CapexStageSubtotals;
}

/** Sum a set of report lines into stage subtotals. Exported so the workbook and
 *  both PDFs aggregate identically rather than each rolling their own loop. */
export function sumCapexStages(lines: Array<{ stage: string; amount: number }>): CapexStageSubtotals {
  const out: CapexStageSubtotals = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0, exclLand: 0, total: 0 };
  for (const l of lines) {
    const amt = l.amount ?? 0;
    if (l.stage === 'land') out.land += amt;
    else if (l.stage === 'hard') out.hard += amt;
    else if (l.stage === 'soft') out.soft += amt;
    else if (l.stage === 'marketing') out.marketing += amt;
    else if (l.stage === 'operating') out.operating += amt;
    out.total += amt;
  }
  // Construction cost: land AND marketing both sit outside it.
  out.exclLand = out.hard + out.soft + out.operating;
  return out;
}

/** Roll per-asset subtotals up to the project. */
export function totalCapexStages(assets: Array<{ subtotals: CapexStageSubtotals }>): CapexStageSubtotals {
  const out: CapexStageSubtotals = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0, exclLand: 0, total: 0 };
  for (const a of assets) {
    out.land += a.subtotals.land;
    out.hard += a.subtotals.hard;
    out.soft += a.subtotals.soft;
    out.marketing += a.subtotals.marketing;
    out.operating += a.subtotals.operating;
    out.total += a.subtotals.total;
  }
  out.exclLand = out.hard + out.soft + out.operating;
  return out;
}
export interface CapexResultTable { title: string; rows: M4Row[] }
/**
 * ONE ASSET'S CAPEX SERIES, KEYED BY ID (2026-09-10).
 *
 * The Excel model needs the per-ASSET series (it writes one block per asset),
 * while the result tables now consolidate by phase and type. It used to dig the
 * per-asset series back out of a summary table by matching the row LABEL to
 * `asset.name`, which was a lookup on a display string: it broke the moment a
 * summary row stopped being one asset, and it would have broken anyway once
 * two assets could share a label. The series are carried here instead, by id.
 */
export interface CapexAssetSeries {
  assetId: string;
  /** The label every surface calls this asset, resolved once. */
  name: string;
  phaseId: string;
  phaseName: string;
  inclAll: number[];
  exclInKind: number[];
  exclAll: number[];
}

export interface CapexReport {
  inputAssets: CapexInputAsset[];
  results: CapexResultTable[];
  /** Per-asset series for the Excel model, which is per asset by design. */
  assetSeries: CapexAssetSeries[];
}

/** Human label for a cost line's method = what its rate multiplies. */
function basisLabel(method?: string): string {
  switch (method) {
    case 'fixed': return 'Fixed (lump sum)';
    case 'rate_per_land': return 'per Plot Area sqm';
    case 'rate_per_nda': return 'per Plot Area sqm (legacy)';
    case 'rate_per_roads': return 'per Roads sqm (retired, always 0)';
    case 'rate_per_gfa': return 'per Total GFA sqm';
    case 'rate_per_bua': return 'per Total BUA sqm';
    case 'rate_per_nsa': return 'per NSA or GLA sqm';
    case 'rate_per_unit': return 'per Unit';
    case 'rate_per_parking_bay': return 'per Parking slot';
    case 'rate_x_parking_area': return 'per Parking area';
    case 'rate_x_net_developable_area': return 'per Net developable sqm';
    case 'rate_x_footprint_area': return 'per Footprint sqm';
    case 'rate_x_landscape_area': return 'per Landscape sqm';
    case 'rate_x_support_area': return 'per Support area';
    case 'rate_x_specific_subunit': return 'per Sub-unit area';
    case 'percent_of_construction': return '% of Construction';
    case 'percent_of_selected': return '% of Selected lines';
    case 'percent_of_total_land': return '% of Total land';
    case 'percent_of_cash_land': return '% of Cash land';
    case 'percent_of_inkind_land': return '% of In-kind land';
    case 'percent_of_total_revenue': return '% of Total revenue';
    default: return method ?? '-';
  }
}
const isPercentMethod = (method?: string): boolean => !!method && method.startsWith('percent_');
/** Percent methods: base = amount x 100 / value (value is in percent units, see
 *  the engine's clamp(v,0,100)/100), i.e. the reference amount the % multiplies. */
function percentBase(amount: number, value: number, label: string): { value: number | null; label: string; kind: MetricKind } {
  return { value: value ? (amount * 100) / value : null, label, kind: 'money' };
}
/** The basis a cost line's rate/percentage multiplies (for the Capex input
 *  "Quantity / Basis" column): a physical quantity for rate lines, the reference
 *  currency amount for percent lines, nothing for a fixed lump sum. */
function basisFor(method: string | undefined, m: AssetAreaMetrics, amount: number, value: number): { value: number | null; label: string; kind: MetricKind } {
  switch (method) {
    case 'rate_per_land': return { value: m.landSqm, label: 'Land sqm', kind: 'area' };
    case 'rate_per_nda': return { value: m.ndaSqm, label: 'Land sqm', kind: 'area' };
    case 'rate_per_roads': return { value: m.roadsSqm, label: 'Roads sqm', kind: 'area' };
    case 'rate_per_gfa': return { value: m.gfa, label: 'GFA sqm', kind: 'area' };
    case 'rate_per_bua': return { value: m.bua, label: 'BUA sqm', kind: 'area' };
    case 'rate_per_nsa': return { value: m.nsa, label: 'NSA or GLA sqm', kind: 'area' };
    case 'rate_per_unit': return { value: m.unitCount, label: 'units', kind: 'count' };
    case 'rate_per_parking_bay': return { value: m.parkingBays, label: 'slots', kind: 'count' };
    case 'rate_x_parking_area': return { value: m.parkingArea, label: 'parking sqm', kind: 'area' };
    case 'rate_x_net_developable_area': return { value: m.netDevelopableArea, label: 'net developable sqm', kind: 'area' };
    case 'rate_x_footprint_area': return { value: m.footprintArea, label: 'footprint sqm', kind: 'area' };
    case 'rate_x_landscape_area': return { value: m.landscapeArea, label: 'landscape sqm', kind: 'area' };
    case 'rate_x_support_area': return { value: m.supportArea, label: 'support sqm', kind: 'area' };
    case 'percent_of_total_land': return percentBase(amount, value, 'of total land');
    case 'percent_of_cash_land': return percentBase(amount, value, 'of cash land');
    case 'percent_of_inkind_land': return percentBase(amount, value, 'of in-kind land');
    case 'percent_of_selected': return percentBase(amount, value, 'of selected lines');
    case 'percent_of_construction': return percentBase(amount, value, 'of construction');
    case 'percent_of_total_revenue':
    case 'percent_of_revenue_cash':
    case 'percent_of_revenue_sale':
      return percentBase(amount, value, 'of total revenue');
    default: return { value: null, label: '', kind: 'none' };
  }
}

/** Project a phase-relative per-period series onto the project axis.
 *
 *  2026-08-19: this spelled the rule out again (local i=0 -> max(0, offset-1),
 *  i>=1 -> offset+i-1), which is the shape TRAPS 7.12 is about, and a THIRD copy
 *  was about to be written for the Module 2 selling-cost schedule. It now calls
 *  `phaseLocalToProjectIndex`, the one definition, and the shared helper below
 *  calls this. */
export function projectOntoAxis(perPeriod: number[], offset: number, N: number): number[] {
  const out = new Array<number>(N).fill(0);
  for (let i = 0; i < perPeriod.length; i++) {
    const projIdx = phaseLocalToProjectIndex(i, offset);
    if (projIdx >= 0 && projIdx < N) out[projIdx] += perPeriod[i] ?? 0;
  }
  return out;
}

const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

/**
 * What the planner needs from an asset: EXACTLY what the grouping function
 * needs, said by reference rather than copied.
 *
 * Copying the shape meant spelling out the type-reference field, and
 * `verify-asset-type-standards` A1 forbids this surface from naming it at all,
 * rightly: no report or export may read the asset type standards. Taking the
 * shape from `groupAssetsForConsolidation` keeps one definition of what a
 * groupable asset is and keeps the token where it belongs, in core.
 */
export type CapexPlannableAsset =
  Parameters<typeof groupAssetsForConsolidation>[0][number] & { name?: string };
/**
 * THE ROWS OF A CAPEX SUMMARY, AND THEIR ORDER (2026-09-11).
 *
 * Exported because the same three tables are built twice: here, for the PDF and
 * the workbook, and on the Costs screen, which has its own period axis and
 * granularity and so cannot share the whole builder. What it CAN share is the
 * answer to "what is a row and where does it sit", which is the part that was
 * different: the screen printed one row per plot while these tables merged by
 * line, so the same three tables disagreed about their own shape.
 *
 * ONE ROW PER CONSOLIDATED LINE, by `groupAssetsForConsolidation`, the same
 * function the assets tab groups table 4 by. Two Branded Villas plots in one
 * phase are one row.
 *
 * A COMPANION SITS WITH ITS OWN LINE, not at the end. `groupAssetsForConsolidation`
 * excludes companions by design (a companion is not a plot), so a first cut
 * appended them after every grouped line and phase 1's retail strip printed
 * below phase 2's plots. The retail companion's id is DERIVED from the line key
 * (`retailCompanionId`), so the line it belongs to is a lookup rather than a
 * guess, and it renders immediately under its host line.
 *
 * THE PHASE IS NOT IN THE LABEL. It is its own column, and a label carrying it
 * as well printed it twice on every row.
 *
 * AN ASSET IN NO LINE AND NO COMPANION SLOT STILL GETS A ROW, at the end of its
 * own phase. Nothing produces one today; it exists so that an asset can never
 * vanish from a table whose total still includes it, which is the one failure
 * these tables exist to rule out.
 */
export interface CapexSummaryLine {
  /** Stable across a render: the consolidation key, or the asset id. */
  key: string;
  /** The line's name WITHOUT its phase. */
  label: string;
  phaseId: string;
  phaseName: string;
  /** The assets whose figures this row sums, in the order they were grouped. */
  assetIds: string[];
  /** True for a row that is one companion standing beside its line. */
  isCompanion: boolean;
}

export function planCapexSummaryLines(
  assets: readonly CapexPlannableAsset[],
  phases: readonly { id: string; name?: string }[],
  labelOf: (assetId: string) => string,
): CapexSummaryLine[] {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const phaseName = (id: string): string => phases.find((p) => p.id === id)?.name ?? '';
  const placed = new Set<string>();
  const out: CapexSummaryLine[] = [];

  for (const g of groupAssetsForConsolidation(
    assets as unknown as Parameters<typeof groupAssetsForConsolidation>[0],
    phases.map((p) => p.id),
    normaliseAssetTypeId,
  )) {
    const ids = g.assets.map((a) => a.id).filter((id) => byId.has(id));
    if (ids.length === 0) continue;
    for (const id of ids) placed.add(id);
    out.push({
      key: g.key, label: g.typeLabel, phaseId: g.phaseId, phaseName: phaseName(g.phaseId),
      assetIds: ids, isCompanion: false,
    });
    // ITS OWN COMPANION, IMMEDIATELY BELOW. Derived from the line key, never
    // matched by name: the label is a display string and can repeat.
    const cid = retailCompanionId(g.key);
    const companion = byId.get(cid);
    if (companion !== undefined) {
      placed.add(cid);
      out.push({
        key: cid, label: `${g.typeLabel} (Retail)`, phaseId: g.phaseId, phaseName: phaseName(g.phaseId),
        assetIds: [cid], isCompanion: true,
      });
    }
  }

  // Anything the grouping did not reach, kept in its own phase rather than
  // dropped. Ordered by the phase list so an unknown phase sorts last.
  const rank = new Map(phases.map((p, i) => [p.id, i] as const));
  const strays = assets
    .filter((a) => !placed.has(a.id))
    .sort((x, y) => (rank.get(x.phaseId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(y.phaseId) ?? Number.MAX_SAFE_INTEGER));
  for (const a of strays) {
    out.push({
      key: a.id, label: labelOf(a.id), phaseId: a.phaseId, phaseName: phaseName(a.phaseId),
      assetIds: [a.id], isCompanion: a.isCompanion === true,
    });
  }
  return out;
}

export function buildCapexReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState): CapexReport {
  const { project, phases, assets: rawAssets, parcels, subUnits, costLines, costOverrides, landAllocationMode } = state;
  // THE TYPE'S MASSING, RESOLVED AT THIS DOOR TOO (2026-09-11). The engine reads
  // the chain for the retail land carve and the plot may inherit its coverage,
  // FAR or service share from the asset type. The composer resolves that for
  // everything it computes; this builder is entered from the PDF and the
  // workbook with the raw state, so it resolves for itself. Same call, same
  // rule, and `verify-retail-companion` J5 fails if a door goes missing.
  const assets = withInheritedMassingAll(rawAssets, (a) => chainMassingFor(a, project.assetTypeValues));
  const N = snap.yearLabels.length;
  const projectStartYear = snap.projectStartYear;
  const lineById = new Map(costLines.map((c) => [c.id, c] as const));

  interface AssetCapex {
    assetId: string;
    name: string;
    phaseId: string;
    phaseName: string;
    inclAll: number[];
    exclInKind: number[];
    exclAll: number[];
    perLine: Array<{ name: string; values: number[] }>;
  }
  const inputAssets: CapexInputAsset[] = [];
  const assetCapex: AssetCapex[] = [];

  for (const a of assets) {
    if (a.visible === false) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const breakdown = computeAssetCost({
      asset: a, project, phase, parcels, assets, subUnits, costLines, costOverrides,
      landAllocationMode,
      parcelFunding: project.financing?.parcelFunding,
      // 2026-08-16: the snapshot already carries the revenue engine's output,
      // so a collections-following line phases here exactly as it does in the
      // model. Without this the report and the P&L disagreed about WHEN a
      // marketing or commission cost lands, while agreeing on the total.
      collectionsPerPeriod: collectionsForAsset(snap.revenue, a.id, phase, projectStartYear),
      revenue: snap.revenue,
    });
    if ((breakdown.total ?? 0) === 0) continue;
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const metrics = resolveAssetAreaMetrics(a, project, parcels, assets.filter((x) => x.phaseId === a.phaseId), subUnits, landAllocationMode);

    // Input: one row per contributing cost line, with the per-metric quantity
    // and the engine amount.
    const lines: CapexInputLine[] = [];
    for (const [lineId, amount] of Object.entries(breakdown.byLineId)) {
      if (!amount) continue;
      const cl = lineById.get(lineId);
      if (!cl) continue;
      const b = basisFor(cl.method, metrics, amount, cl.value);
      // Effective phasing window + method for THIS asset: an active per-asset
      // override (overridden !== false) wins field-by-field, otherwise the
      // master line. Mirrors the calc engine's resolution.
      const ov = costOverrides.find((o) => o.assetId === a.id && o.lineId === lineId && o.overridden !== false);
      lines.push({
        id: lineId,
        method: String(cl.method ?? ''),
        selectedLineIds: cl.selectedLineIds ?? [],
        name: cl.name,
        // deriveCostStage, not the stored field: a standard line's stage is
        // id-derived, and reading the raw field here would let the report
        // disagree with the screen tiles and the engine for any line whose
        // stored stage was never updated.
        stage: String(deriveCostStage(cl) ?? cl.stage ?? '-'),
        basis: basisLabel(cl.method),
        rate: cl.value,
        isFixed: cl.method === 'fixed',
        isPercent: isPercentMethod(cl.method),
        metricValue: b.value,
        metricLabel: b.label,
        metricKind: b.kind,
        amount,
        perPeriod: projectOntoAxis(breakdown.perLinePerPeriod?.[lineId] ?? [], offset, N),
        startPeriod: ov?.startPeriod ?? cl.startPeriod,
        endPeriod: ov?.endPeriod ?? cl.endPeriod,
        phasing: String(ov?.phasing ?? cl.phasing ?? 'even'),
        perSubUnitRates: cl.method === 'per_sub_unit_custom_rates' ? (ov?.perSubUnitRates ?? cl.perSubUnitRates) : undefined,
      });
    }
    if (lines.length) {
      inputAssets.push({
        assetId: a.id, assetName: assetLabel(a, state), phaseName: phase.name, lines,
        total: breakdown.total,
        subtotals: sumCapexStages(lines),
      });
    }

    // Results: project each per-period variant onto the axis.
    const inclAll = projectOntoAxis(breakdown.perPeriod ?? [], offset, N);
    const landTotal = projectOntoAxis(breakdown.perPeriodLandTotal ?? [], offset, N);
    const landInKind = projectOntoAxis(breakdown.perPeriodLandInKind ?? [], offset, N);
    const exclInKind = inclAll.map((v, i) => v - (landInKind[i] ?? 0));
    const exclAll = inclAll.map((v, i) => v - (landTotal[i] ?? 0));
    const perLine = Object.entries(breakdown.perLinePerPeriod ?? {})
      .map(([lineId, series]) => ({ name: lineById.get(lineId)?.name ?? lineId, values: projectOntoAxis(series, offset, N) }))
      .filter((r) => anyNonZero(r.values));
    // THE OUTPUT USES THE INPUT'S LABEL (2026-09-10). This read `a.name`, the
    // raw stored field, while the input table three lines up read
    // `assetLabel(a, state)`, so the two halves of the same tab could call one
    // asset two different things.
    assetCapex.push({
      assetId: a.id, name: assetLabel(a, state), phaseId: a.phaseId, phaseName: phase.name,
      inclAll, exclInKind, exclAll, perLine,
    });
  }

  // Project totals from the snapshot (authoritative; per-asset rows reconcile).
  const cap = snap.financing.capex.perPeriod;
  const totalInclAll = cap.inclAllLand.slice(0, N);
  const totalExclInKind = cap.exclLandInKind.slice(0, N);
  const totalExclAll = cap.exclAllLand.slice(0, N);

  const results: CapexResultTable[] = [];

  // Table 1: per-cost-line, per-asset schedule.
  const t1Rows: M4Row[] = [];
  for (const ac of assetCapex) {
    if (!anyNonZero(ac.inclAll)) continue;
    t1Rows.push({ label: ac.name, values: [], isSection: true });
    for (const ln of ac.perLine) t1Rows.push({ label: ln.name, values: ln.values, indent: 1 });
    t1Rows.push({ label: `Subtotal, ${ac.name}`, values: ac.inclAll, isSubtotal: true });
  }
  if (t1Rows.length) {
    t1Rows.push({ label: 'Project Total (incl. all land)', values: totalInclAll, isTotal: true });
    results.push({ title: 'Capex Schedule by Period (per cost line, per asset)', rows: t1Rows });
  }

  /**
   * TABLES 2-4 CONSOLIDATE BY PHASE AND TYPE (2026-09-10).
   *
   * They were per asset, so a phase holding four Branded Villas plots printed
   * four rows here while table 4 of the assets tab printed ONE line, and the
   * two could not be read against each other. The key is not recomputed: it is
   * `groupAssetsForConsolidation`, the same function the assets tab groups by,
   * so the summary and that table agree by construction.
   *
   * TABLE 1 STAYS PER ASSET. It is the cost-line schedule, and a cost line
   * belongs to a plot: merging it would hide which plot carries which rate.
   *
   * AN ASSET IN NO GROUP KEEPS ITS OWN ROW. `groupAssetsForConsolidation`
   * excludes companions by design (a companion is not a plot), and the retail
   * companion has carried its own cost lines since consolidation step 6. It
   * would otherwise vanish from the summary while still sitting in the total,
   * which is the one failure this table exists to rule out.
   */
  const capexById = new Map(assetCapex.map((ac) => [ac.assetId, ac] as const));
  const summaryLines = planCapexSummaryLines(
    assets as unknown as CapexPlannableAsset[],
    phases,
    (id) => capexById.get(id)?.name ?? id,
  ).map((ln) => ({
    ...ln,
    members: ln.assetIds.map((id) => capexById.get(id)).filter((ac): ac is AssetCapex => ac !== undefined),
  })).filter((ln) => ln.members.length > 0);

  const sumOver = (members: readonly AssetCapex[], pick: (ac: AssetCapex) => number[]): number[] => {
    const out = new Array<number>(N).fill(0);
    for (const m of members) { const v = pick(m); for (let t = 0; t < N; t++) out[t] += v[t] ?? 0; }
    return out;
  };

  /**
   * A SUBTOTAL PER PHASE, INSIDE THE TABLE (2026-09-11).
   *
   * A phase total used to mean opening a second table and adding rows up by
   * eye. It sits under the phase it totals now, and the grand total still
   * closes the table, so the two readings never need two places.
   *
   * ONLY WHERE THERE IS MORE THAN ONE PHASE. On a single-phase project the
   * subtotal would repeat the grand total one row above it, which says nothing
   * and invites the reader to wonder what the difference is.
   */
  const multiPhase = phases.length > 1;
  const summaryTable = (title: string, pick: (ac: AssetCapex) => number[], total: number[], totalLabel: string): CapexResultTable => {
    const rows: M4Row[] = [];
    let phaseId: string | null = null;
    let phaseRows: M4Row[] = [];
    const closePhase = (): void => {
      if (!multiPhase || phaseRows.length === 0 || phaseId === null) { rows.push(...phaseRows); phaseRows = []; return; }
      const name = phases.find((p) => p.id === phaseId)?.name ?? phaseId;
      const sub = new Array<number>(N).fill(0);
      for (const r of phaseRows) for (let t = 0; t < N; t++) sub[t] += r.values[t] ?? 0;
      rows.push(...phaseRows, { label: `Subtotal, ${name}`, values: sub, isSubtotal: true });
      phaseRows = [];
    };
    for (const ln of summaryLines) {
      const values = sumOver(ln.members, pick);
      if (!anyNonZero(values)) continue;
      if (phaseId !== null && ln.phaseId !== phaseId) closePhase();
      phaseId = ln.phaseId;
      // THE PHASE RIDES IN ITS OWN COLUMN on a surface that has one. An M4Row
      // carries a label and numbers, so here the phase is prefixed onto the
      // label instead, ONCE, and only where the project has more than one.
      phaseRows.push({
        label: multiPhase && ln.phaseName !== '' ? `${ln.phaseName}: ${ln.label}` : ln.label,
        values,
        indent: 1,
      });
    }
    closePhase();
    rows.push({ label: totalLabel, values: total, isTotal: true });
    return { title, rows };
  };
  results.push(summaryTable('Total Capex (incl. all land)', (ac) => ac.inclAll, totalInclAll, 'Total Capex (incl. all land)'));
  results.push(summaryTable('Capex excl. Land In-Kind (cash-impact schedule)', (ac) => ac.exclInKind, totalExclInKind, 'Total Capex (excl. land in-kind)'));
  results.push(summaryTable('Capex excl. Total Land (pure development cost)', (ac) => ac.exclAll, totalExclAll, 'Total Capex (excl. all land)'));

  const assetSeries: CapexAssetSeries[] = assetCapex.map((ac) => ({
    assetId: ac.assetId, name: ac.name, phaseId: ac.phaseId, phaseName: ac.phaseName,
    inclAll: ac.inclAll, exclInKind: ac.exclInKind, exclAll: ac.exclAll,
  }));

  return { inputAssets, results, assetSeries };
}
