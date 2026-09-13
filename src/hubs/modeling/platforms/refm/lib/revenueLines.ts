/**
 * revenueLines.ts (2026-09-13, Module 2 restructure step 2)
 *
 * WHERE A REVENUE ROW FILES, AND WHAT A REVENUE ROW IS. Stated once.
 *
 * THE SECTION IS THE CATEGORY, NEVER THE STRATEGY. Until this file the
 * Revenue Inputs tab, its quick nav, the Output tab (twice), the Schedules
 * feed and the cost of sales tab each decided a section from `strategy` and
 * `isCompanion` in their own words, with three different answers between them:
 * the nav listed a retail strip under Hospitality AND Retail, the Output tab
 * rendered the same strip as a "No operate config yet" card under Hospitality
 * and dropped it from the Retail total, and the Schedules feed skipped it
 * outright. A strategy says which INPUTS a line takes (velocity, or ADR and
 * occupancy, or rent and occupancy); it does not say what the building is. The
 * founder reads by the building: Residential, Hospitality, Standalone
 * Commercial, Retail Ground Floor, and that is the order here. The category
 * comes from the SAME rule Table 6 files capex by (`assetCapexCategory`, the
 * type label resolved against the project's own list), so a hotel sold off
 * plan files under Hospitality on both.
 *
 * TWO NAMED EXCEPTIONS, both decided by the founder on 2026-09-13: a retail
 * ground-floor strip is its own section, whatever its hosts are, because it
 * carves from many lines and belongs to none; and the Operate companion of a
 * Sell + Manage line files under Hospitality, because what it earns is room
 * revenue.
 *
 * A LINE IS THE UNIT OF REVENUE, AS IT IS THE UNIT OF CAPEX (2026-09-12). A
 * consolidated line is one type in one phase across its plots; Table 5 lists
 * its sub-units pooled across those plots, and that pooled list is what a
 * strategy prices. The engine still computes PER ASSET, keyed by asset id,
 * and every downstream reader (cost of sales, statements, escrow, selling
 * costs, both exports) is untouched: a line's result is the SUM of its
 * members', and a line's terms are ONE object written to every member. That
 * is the precedent capex set, and it keeps the engine byte-identical on the
 * day the screen changes.
 *
 * PRESENTATION AND ADDRESSING ONLY. Nothing here computes a model value.
 * No em dashes in this file.
 */

import { groupAssetsForConsolidation } from '@/src/core/calculations/consolidation';
import { normaliseAssetTypeId } from '@/src/core/calculations/typeKey';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { assetCapexCategory } from './reports/capexReports';
import { REVENUE_KEY_BY_STRATEGY } from './state/strategySwitch';
import type { Asset, AssetStrategy, Phase, Project, SubUnit } from './state/module1-types';

export type RevenueSection =
  | 'Residential'
  | 'Hospitality'
  | 'Standalone Commercial'
  | 'Retail Ground Floor'
  | 'Other';

/** The founder's reading order (2026-09-13). */
export const REVENUE_SECTIONS: readonly RevenueSection[] = [
  'Residential', 'Hospitality', 'Standalone Commercial', 'Retail Ground Floor', 'Other',
];

/** A stable key per section for DOM ids, storage keys and test ids. */
export const REVENUE_SECTION_KEY: Record<RevenueSection, string> = {
  'Residential': 'residential',
  'Hospitality': 'hospitality',
  'Standalone Commercial': 'commercial',
  'Retail Ground Floor': 'retail-ground-floor',
  'Other': 'other',
};

/** What the section holds, in the section's own words. */
export const REVENUE_SECTION_META: Record<RevenueSection, string> = {
  'Residential': 'Residential lines: sale velocity, payment terms and recognition',
  'Hospitality': 'Hospitality lines and Operate companions: keys, ADR and occupancy',
  'Standalone Commercial': 'Commercial and retail lines held for lease: rent, occupancy and indexation',
  'Retail Ground Floor': 'Ground-floor retail strips carved from their host lines',
  'Other': 'Lines whose type is in no category',
};

type SectionAsset = Pick<Asset, 'type' | 'isCompanion' | 'companionType'>;
type SectionProject = Pick<Project, 'assetTypes'>;

/** THE ONE FILING RULE. */
export function revenueSection(asset: SectionAsset, project: SectionProject): RevenueSection {
  if (isRetailCompanion(asset as Asset)) return 'Retail Ground Floor';
  if (asset.isCompanion === true) return 'Hospitality';
  const cat = assetCapexCategory(asset, project);
  if (cat === 'Retail') return 'Standalone Commercial';
  return cat;
}

export type RevenueForm = 'sell' | 'operate' | 'lease';

/** Which inputs a strategy takes. The STRATEGY decides this, never the section. */
export function revenueFormFor(strategy: AssetStrategy | string | undefined): RevenueForm {
  return REVENUE_KEY_BY_STRATEGY[strategy as AssetStrategy] ?? 'sell';
}

export interface RevenueLine {
  /** The consolidation key for a line of plots, `companion__<id>` for a
   *  companion. Stable, so DOM anchors and collapse state survive a rename. */
  key: string;
  /** The type label, as Table 5 heads the line; a strip says "(Retail)" and an
   *  Operate companion "(Operate)". */
  label: string;
  section: RevenueSection;
  phaseId: string;
  phaseName?: string;
  strategy: AssetStrategy;
  form: RevenueForm;
  /** The first member. The line's terms are READ from it; they are WRITTEN to
   *  every member, so on a line kept in step they are the same object. */
  host: Asset;
  /** Every asset the line's terms fan out to. One for a companion. */
  members: Asset[];
  /** The line's Table 5 rows, pooled across members, Support excluded: what
   *  the strategy prices. */
  subUnits: SubUnit[];
  isStrip: boolean;
  isOperateCompanion: boolean;
  /** The parent line's key, for the Operate companion's linked-to chip. */
  parentLineKey?: string;
  parentAssetId?: string;
}

/**
 * THE LINES, in reading order: section, then phase, then label. Hidden assets
 * are not members; a line whose members are all hidden is not a line.
 */
export function planRevenueLines(
  assets: readonly Asset[],
  subUnits: readonly SubUnit[],
  phases: readonly Phase[],
  project: SectionProject,
): RevenueLine[] {
  const visible = assets.filter((a) => a.visible !== false);
  const phaseIds = phases.map((p) => p.id);
  const phaseName = (id: string): string | undefined => phases.find((p) => p.id === id)?.name;
  const rowsOf = (memberIds: Set<string>): SubUnit[] =>
    subUnits.filter((u) => memberIds.has(u.assetId) && isRevenueSubUnit(u));

  const out: RevenueLine[] = [];
  const lineKeyByAssetId = new Map<string, string>();

  // Plots: the consolidation grouping, which excludes every companion.
  const groups = groupAssetsForConsolidation(
    visible.filter((a) => a.isCompanion !== true),
    phaseIds,
    normaliseAssetTypeId,
  );
  for (const g of groups) {
    const members = g.assets as Asset[];
    const host = members[0];
    if (!host) continue;
    for (const m of members) lineKeyByAssetId.set(m.id, g.key);
    out.push({
      key: g.key,
      label: g.typeLabel,
      section: revenueSection(host, project),
      phaseId: g.phaseId,
      phaseName: phaseName(g.phaseId),
      strategy: host.strategy,
      form: revenueFormFor(host.strategy),
      host,
      members,
      subUnits: rowsOf(new Set(members.map((m) => m.id))),
      isStrip: false,
      isOperateCompanion: false,
    });
  }

  // Companions: one line each. A strip files under its own section; an
  // Operate companion under Hospitality beside a chip naming its parent.
  for (const a of visible) {
    if (a.isCompanion !== true) continue;
    const strip = isRetailCompanion(a);
    out.push({
      key: `companion__${a.id}`,
      label: strip ? `${(a.type || 'Retail').trim()} (Retail)` : `${(a.type || 'Operate').trim()} (Operate)`,
      section: revenueSection(a, project),
      phaseId: a.phaseId,
      phaseName: phaseName(a.phaseId),
      strategy: a.strategy,
      form: revenueFormFor(a.strategy),
      host: a,
      members: [a],
      subUnits: rowsOf(new Set([a.id])),
      isStrip: strip,
      isOperateCompanion: !strip,
      parentLineKey: a.parentAssetId ? lineKeyByAssetId.get(a.parentAssetId) : undefined,
      parentAssetId: a.parentAssetId,
    });
  }

  const rank = (l: RevenueLine): [number, number, string] => {
    const s = REVENUE_SECTIONS.indexOf(l.section);
    const p = phaseIds.indexOf(l.phaseId);
    return [s < 0 ? REVENUE_SECTIONS.length : s, p < 0 ? phaseIds.length : p, l.label];
  };
  return out
    .map((l, i) => ({ l, i, r: rank(l) }))
    .sort((a, b) => {
      if (a.r[0] !== b.r[0]) return a.r[0] - b.r[0];
      if (a.r[1] !== b.r[1]) return a.r[1] - b.r[1];
      const s = a.r[2].localeCompare(b.r[2]);
      return s !== 0 ? s : a.i - b.i;
    })
    .map((x) => x.l);
}

/** The lines grouped by section, sections in reading order, empty ones out. */
export function groupRevenueLines(lines: readonly RevenueLine[]): Array<{ section: RevenueSection; lines: RevenueLine[] }> {
  return REVENUE_SECTIONS
    .map((section) => ({ section, lines: lines.filter((l) => l.section === section) }))
    .filter((g) => g.lines.length > 0);
}

/** The line an asset is on, for a per-asset result that needs a line label. */
export function lineForAsset(lines: readonly RevenueLine[], assetId: string): RevenueLine | undefined {
  return lines.find((l) => l.members.some((m) => m.id === assetId));
}
