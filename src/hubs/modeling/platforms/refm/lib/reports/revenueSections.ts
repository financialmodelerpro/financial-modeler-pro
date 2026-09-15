/**
 * revenueSections.ts (2026-09-15, step 9)
 *
 * REVENUE FILES BY CATEGORY, NEVER BY STRATEGY, ON EVERY STATEMENT A READER SEES.
 *
 * The P&L revenue headers, and the revenue summaries in the PDF, the workbook
 * and the IC schedule, filed an asset by its STRATEGY (Sell under Residential,
 * Operate under Hospitality, Lease under Retail) while the Revenue tab files it
 * by its CATEGORY (`revenueSection`, the one filing rule). The two agree only
 * while every strategy matches its category: a Lease line typed as villas would
 * have sat under Retail on the statement and under Residential on the tab. And
 * on the live project they already disagreed in the grain of the sections: the
 * statement had one Retail row where the tab has Standalone Commercial and
 * Retail Ground Floor.
 *
 * Each section's figure is the sum of its assets' own revenue (the per-asset
 * P&L), so the sections add to total revenue exactly. The engine's strategy
 * buckets are untouched: Returns reads them as income from HELD assets (NOI,
 * the terminal value), which is a question of strategy, not of type.
 *
 * No em dashes in this file.
 */
import { REVENUE_SECTIONS, REVENUE_SECTION_KEY, revenueSection, type RevenueSection } from '../revenueLines';
import type { Asset, Project } from '../state/module1-types';

export interface RevenueSectionTotal {
  section: RevenueSection;
  key: string;
  /** "Standalone Commercial revenue", for a summary row. */
  label: string;
  values: number[];
  assetIds: string[];
}

export function revenueBySection(
  snap: { axisLength: number; perAssetPL: ReadonlyMap<string, { revenuePerPeriod: readonly number[] }> },
  state: { assets: readonly Asset[]; project: Pick<Project, 'assetTypes'> },
  include?: (a: Asset) => boolean,
): RevenueSectionTotal[] {
  const N = snap.axisLength;
  const out: RevenueSectionTotal[] = [];
  for (const section of REVENUE_SECTIONS) {
    const members = state.assets.filter((a) => a.visible !== false && (!include || include(a))
      && snap.perAssetPL.has(a.id) && revenueSection(a, state.project) === section);
    if (members.length === 0) continue;
    const values = new Array<number>(N).fill(0);
    for (const a of members) {
      const rev = snap.perAssetPL.get(a.id)!.revenuePerPeriod;
      for (let t = 0; t < N; t++) values[t] += rev[t] ?? 0;
    }
    out.push({ section, key: REVENUE_SECTION_KEY[section], label: `${section} revenue`, values, assetIds: members.map((a) => a.id) });
  }
  return out;
}
