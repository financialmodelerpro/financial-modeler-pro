/**
 * assetCategory.ts (2026-09-21)
 *
 * WHAT KIND OF THING AN ASSET IS, resolved from its type. A LEAF: it imports
 * only core and the type registry, so both `capexReports` and `revenueLines`
 * can read it without importing each other.
 *
 * WHY IT MOVED HERE. This rule lived in `capexReports`, and `revenueLines`
 * imported it to build the finer SECTION rule on top (a retail strip is
 * "Retail Ground Floor", an Operate companion is "Hospitality", and a "Retail"
 * type held for lease is "Standalone Commercial"). Capex then filed its own
 * Table 6 by the COARSE rule while the P&L filed revenue by the fine one, so
 * on FMP - MARINA GATE four of eight assets appeared under a different heading
 * in the cost tables than in the income statement: both retail strips and both
 * Standalone Commercial lines sat in one "Retail" row against two separate
 * revenue sections. A reader could not carry a line from its cost to its
 * revenue.
 *
 * Capex now files by the SAME section rule. This file keeps the coarse
 * resolver, which the section rule is built from and which the Assets tab
 * still asks directly ("is this type hospitality?"), and breaking it out is
 * what lets the section rule be the one filing rule without a cycle.
 *
 * No em dashes in this file.
 */
import { normaliseAssetTypeId } from '@/src/core/calculations/typeKey';
import { ASSET_TYPES_BY_CATEGORY, ASSET_TYPE_CATEGORIES, type AssetTypeCategory } from '../state/module1-types';

/** The coarse kind: a built-in category, or 'Other' when the type says nothing. */
export type CapexCategory = AssetTypeCategory | 'Other';
export const CAPEX_CATEGORIES: readonly CapexCategory[] = [...ASSET_TYPE_CATEGORIES, 'Other'];

/**
 * The category a type belongs to: the category SET on Asset Types & Standards
 * first, then the built-in lists, then the words in the label.
 */
export function assetCapexCategory(
  asset: { type?: string; isCompanion?: boolean; companionType?: string },
  project: { assetTypes?: ReadonlyArray<{ id: string; label: string; category?: string }> },
): CapexCategory {
  if (asset.isCompanion === true && asset.companionType === 'retail') return 'Retail';
  const label = (asset.type ?? '').trim();
  if (label === '') return 'Other';
  const key = normaliseAssetTypeId(label);
  const entry = (project.assetTypes ?? []).find((t) => t.id === key || t.label.trim() === label);
  const declared = entry?.category?.trim();
  if (declared && (ASSET_TYPE_CATEGORIES as readonly string[]).includes(declared)) return declared as AssetTypeCategory;
  for (const cat of ASSET_TYPE_CATEGORIES) {
    if (ASSET_TYPES_BY_CATEGORY[cat].some((l) => l === label || normaliseAssetTypeId(l) === key)) return cat;
  }
  // A firm's own label, not in the built-in lists and with no category set on
  // tab 4: read the word. 'Hotel 5-star', 'Branded Residences', 'Strip Retail'
  // all say what they are. Setting the category on tab 4 outranks this.
  const lower = label.toLowerCase();
  if (/hotel|resort|hospitality|serviced/.test(lower)) return 'Hospitality';
  if (/retail|commercial|mall|shop/.test(lower)) return 'Retail';
  if (/villa|apartment|residen|townhouse|condo|home/.test(lower)) return 'Residential';
  return 'Other';
}
