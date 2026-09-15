/**
 * assetTypeMix.ts (2026-09-15)
 *
 * THE PROJECT'S ASSET TYPES, ONCE EACH, as the portfolio card and the project
 * list show them (`refm_projects.asset_mix`, rewritten on every save).
 *
 * WHY THIS EXISTS. The saved list was built in two places, the three save paths
 * in `module1-sync.ts` and the create path in `RealEstatePlatform.tsx`, both as
 * one entry per visible asset from `Asset.name`. That name was retired on
 * 2026-09-10 and nothing may read it, so the card showed frozen legacy names,
 * repeated per asset ("Branded Villas, Branded Villas, Branded Villas - Retail,
 * ..." on a live project). This is the ONE computation; both paths call it.
 *
 * THE RULE (founder): the types a VISIBLE asset actually uses, once each, in the
 * order of the Types and Standards list, by the types' labels. A type listed on
 * the tab with no asset is not part of the project. The type of an asset
 * resolves through `standardTypeIdFor`, the one lookup (a type id, else the
 * normalised label; a retail strip is ground-floor retail). An asset whose type
 * is not on the list keeps its own type text, tidied, after the listed ones, so
 * nothing silently disappears. Never reads `Asset.name`.
 *
 * No em dashes in this file.
 */

import { sortAssetTypes, type AssetTypeStandard } from './assetTypeStandards';
import { standardTypeIdFor } from './costStandards';
import type { Asset } from './module1-types';

export function projectAssetTypeMix(model: {
  assets: readonly Asset[];
  project: { assetTypes?: readonly AssetTypeStandard[] };
}): string[] {
  const entries = sortAssetTypes(model.project.assetTypes ?? []);
  const used = new Set<string>();
  const loose: string[] = [];
  for (const a of model.assets) {
    if (!a.visible) continue;
    const key = standardTypeIdFor(a, entries);
    if (key === undefined) continue;
    if (entries.some((e) => e.id === key)) { used.add(key); continue; }
    const label = (a.type ?? '').replace(/\s+/g, ' ').trim();
    if (label && !loose.some((l) => l.toLowerCase() === label.toLowerCase())) loose.push(label);
  }
  return [...entries.filter((e) => used.has(e.id)).map((e) => e.label), ...loose];
}
