/**
 * costOfSales.ts, THE Module 2 cost-of-sales layer.
 *
 * ONE computation. The capex base, the capitalised IDC on top of it, the spread
 * across periods, the inventory roll-forward and the vintage matrix are all
 * assembled here, once per Sell asset, and every surface reads the result:
 * the P&L, the balance sheet's inventory, the Module 2 screen, both PDFs and
 * the workbook. No surface assembles a base of its own.
 *
 * WHY THIS FILE EXISTS (2026-08-30). Cost of sales was computed by two engines
 * with different bases. The P&L used `buildCostOfSales` (asset cost + IDC,
 * spread on the recognition share); the Module 2 screen and both exports used a
 * second engine, `buildCostOfSalesV2`, on a base each surface re-assembled by
 * hand. Measured on the live projects, they disagreed by up to 407,131,731 in a
 * single year (34.7% of the P&L figure, RE HUB 2029) and by 62,936,759 over the
 * lifetime (25.4%, Marina Gate). The lifetime totals happened to agree to
 * within 0.24% on RE HUB, which is what hid it.
 *
 * WHY V1 WON, in one line: `SellAssetResult.recognitionPerPeriod` is exactly
 * the series the P&L books as revenue, so spreading the capex base across it is
 * matching in the accounting sense, and it holds gross margin constant per
 * asset (Marina Gate: 60.5% every year). The second engine's cumulative-product
 * factor was not the revenue engine's actual recognition, and swung the margin
 * from 75.7% to 6.4% to 27.6% on one product.
 *
 * THE TWO BASE DEFECTS that came with the losing engine are fixed here rather
 * than reproduced: the Y0 upfront lump is placed with the SHARED
 * `phaseLocalToProjectIndex` (whose clamp exists precisely because the
 * unclamped `offset - 1` deletes a phase-1 lump), and the per-period capex now
 * sums to the asset's total because the truncation in `computeAssetCost` was
 * fixed at source.
 *
 * IDC is NOT recomputed here. It is computed once, correctly, by
 * `computeIdcSnapshot`, and passed in. This layer only decides that it belongs
 * in the base and where it lands.
 *
 * Pure: state in, result out, no store and no I/O.
 *
 * No em dashes in this file.
 */
import { computeAssetCost } from '@/src/core/calculations';
import {
  collectionsForAsset, phaseLocalToProjectIndex, type CollectionsSource,
} from '@/src/core/calculations/capexPhasing';
import { buildCostOfSales, type CostOfSalesResult } from '@/src/core/calculations/revenue';
import type { SellAssetResult } from '@/src/core/calculations/revenue/types';
import type { Asset, Phase } from './state/module1-types';

/** The state this layer reads. Structural, so both resolver states satisfy it. */
export interface CostOfSalesState {
  project: Parameters<typeof computeAssetCost>[0]['project'];
  phases: Phase[];
  assets: Asset[];
  subUnits: Parameters<typeof computeAssetCost>[0]['subUnits'];
  parcels: Parameters<typeof computeAssetCost>[0]['parcels'];
  costLines: Parameters<typeof computeAssetCost>[0]['costLines'];
  costOverrides: Parameters<typeof computeAssetCost>[0]['costOverrides'];
  landAllocationMode: Parameters<typeof computeAssetCost>[0]['landAllocationMode'];
}

export interface AssetCostOfSales {
  assetId: string;
  /** The asset's own cost, from computeAssetCost. */
  assetCost: number;
  /** Capitalised IDC charged through cost of sales for this asset. */
  idc: number;
  /** THE base: assetCost + idc. Nothing else is ever charged. */
  capexBase: number;
  /** The base laid on the project axis (asset capex + IDC). Sums to capexBase,
   *  and is the ONE capex series the inventory roll-forward uses, on screen and
   *  on the balance sheet alike. */
  capexPerPeriod: number[];
  /** The recognition series the spread is weighted by: exactly the revenue the
   *  P&L books for this asset. */
  recognitionPerPeriod: number[];
  totalRecognition: number;
  /** The result of the ONE engine. */
  cos: CostOfSalesResult;
  /** The split by WHICH recognition drove it, not a second computation:
   *  these two sum to cos.perPeriod exactly. */
  cosPresalesPerPeriod: number[];
  cosPostSalesPerPeriod: number[];
  /** Inventory roll-forward: cumulative capexPerPeriod less cumulative cost of
   *  sales. The balance sheet reads this, so screen and statement cannot
   *  disagree. */
  inventoryPerPeriod: number[];
  /** capex period x recognition period. Row i sums to capexPerPeriod[i];
   *  column t sums to cos.perPeriod[t]. A presentation of the same result. */
  vintageMatrix: number[][];
  /** What the row says it is charged on. */
  basis: CostOfSalesBasis;
}

export interface CostOfSalesBasis {
  assetCost: number;
  idc: number;
  capexBase: number;
  /** One line, for the row label, in the shape marketing's basis row uses. */
  label: string;
}

/** THE basis sentence. One definition, so screen, PDF and workbook say the
 *  same thing, including that IDC is inside the base. */
export function costOfSalesBasisLabel(fmt: (v: number) => string, assetCost: number, idc: number): string {
  return idc > 0
    ? `Asset capex ${fmt(assetCost)} plus capitalised IDC ${fmt(idc)}, spread on revenue recognition`
    : `Asset capex ${fmt(assetCost)}, spread on revenue recognition`;
}

/** Lay a phase-local per-period series onto the project axis. Uses the SHARED
 *  Y0 rule; the tail is clamped into the last period rather than dropped, so
 *  the projection can never lose money.
 *
 *  EXPORTED for the verifier: the property that matters (nothing is lost, at
 *  either end) is only meaningfully testable on this function directly. Pinning
 *  it through a fixture asset was vacuous, because a fixture with no cost lines
 *  has no Y0 lump to lose and passed even with the rule sabotaged. */
export function projectCapexOntoAxis(perPeriodLocal: number[], offset: number, N: number): number[] {
  const out = new Array<number>(N).fill(0);
  if (N <= 0) return out;
  for (let i = 0; i < perPeriodLocal.length; i++) {
    const v = perPeriodLocal[i] ?? 0;
    if (v === 0) continue;
    const idx = Math.min(N - 1, phaseLocalToProjectIndex(i, offset));
    out[idx] += v;
  }
  return out;
}

export interface BuildAssetCostOfSalesInput {
  state: CostOfSalesState;
  /** The Sell result for this asset: carries the recognition the P&L books. */
  sellResult: SellAssetResult;
  /** The revenue snapshot, so percent-of-revenue cost methods charge on the
   *  same bases every other surface uses. */
  revenue: CollectionsSource;
  /** Capitalised IDC for this asset, per project-axis period. Computed once by
   *  computeIdcSnapshot and passed in; never recomputed here. */
  idcPerPeriod: number[];
  axisLength: number;
  projectStartYear: number;
}

/**
 * Build the ONE cost-of-sales result for one Sell asset.
 */
export function buildAssetCostOfSales(input: BuildAssetCostOfSalesInput): AssetCostOfSales | null {
  const { state, sellResult, revenue, idcPerPeriod, axisLength: N, projectStartYear } = input;
  const asset = state.assets.find((a) => a.id === sellResult.assetId);
  if (!asset) return null;
  const phase = state.phases.find((p) => p.id === asset.phaseId);
  if (!phase) return null;

  const breakdown = computeAssetCost({
    asset,
    project: state.project,
    phase,
    parcels: state.parcels,
    assets: state.assets,
    subUnits: state.subUnits,
    costLines: state.costLines,
    costOverrides: state.costOverrides,
    landAllocationMode: state.landAllocationMode,
    parcelFunding: state.project.financing?.parcelFunding,
    collectionsPerPeriod: collectionsForAsset(revenue, asset.id, phase, projectStartYear),
    revenue,
  });

  const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  const offset = Math.max(0, phaseStartYear - projectStartYear);
  const capexPerPeriod = projectCapexOntoAxis(breakdown.perPeriod ?? [], offset, N);
  let idc = 0;
  for (let t = 0; t < N; t++) {
    const v = Math.max(0, idcPerPeriod[t] ?? 0);
    capexPerPeriod[t] += v;
    idc += v;
  }
  const assetCost = Math.max(0, breakdown.total);
  const capexBase = capexPerPeriod.reduce((s, v) => s + v, 0);

  // The ONE engine, on the ONE base.
  const recognitionPerPeriod = sellResult.recognitionPerPeriod ?? [];
  const cos = buildCostOfSales(recognitionPerPeriod, capexBase, N);

  // The pre / post split is the SAME spread, attributed to whichever half of
  // the recognition drove it. Not a second computation: these sum to cos.
  const totalRecognition = cos.totalRecognition;
  const cosPresalesPerPeriod = new Array<number>(N).fill(0);
  const cosPostSalesPerPeriod = new Array<number>(N).fill(0);
  if (totalRecognition > 0) {
    for (let t = 0; t < N; t++) {
      const pre = Math.max(0, sellResult.presalesRecognitionPerPeriod?.[t] ?? 0);
      const post = Math.max(0, sellResult.postSalesRecognitionPerPeriod?.[t] ?? 0);
      cosPresalesPerPeriod[t] = capexBase * (pre / totalRecognition);
      cosPostSalesPerPeriod[t] = capexBase * (post / totalRecognition);
    }
  }

  const inventoryPerPeriod = new Array<number>(N).fill(0);
  let cumCapex = 0, cumCos = 0;
  for (let t = 0; t < N; t++) {
    cumCapex += capexPerPeriod[t] ?? 0;
    cumCos += cos.perPeriod[t] ?? 0;
    inventoryPerPeriod[t] = cumCapex - cumCos;
  }

  // Vintage matrix: each period's capex recognised on the same share profile.
  // Row i sums to capexPerPeriod[i]; column t sums to cos.perPeriod[t].
  const vintageMatrix: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  if (totalRecognition > 0) {
    for (let i = 0; i < N; i++) {
      const cx = capexPerPeriod[i] ?? 0;
      if (cx === 0) continue;
      for (let t = 0; t < N; t++) {
        const share = Math.max(0, recognitionPerPeriod[t] ?? 0) / totalRecognition;
        if (share !== 0) vintageMatrix[i][t] = cx * share;
      }
    }
  }

  return {
    assetId: asset.id,
    assetCost, idc, capexBase, capexPerPeriod,
    recognitionPerPeriod: recognitionPerPeriod.slice(0, N),
    totalRecognition,
    cos, cosPresalesPerPeriod, cosPostSalesPerPeriod,
    inventoryPerPeriod, vintageMatrix,
    basis: { assetCost, idc, capexBase, label: costOfSalesBasisLabel((v) => Math.round(v).toLocaleString(), assetCost, idc) },
  };
}
