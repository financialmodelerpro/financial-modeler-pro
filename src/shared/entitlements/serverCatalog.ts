/**
 * serverCatalog.ts
 *
 * Single server-side source for the merged entitlement feature list:
 * live platform_modules rows (derived via deriveModuleFeatureRows) followed by
 * the non-module features_registry catalog rows. Both the Plan Builder
 * (/admin/plans) and the per-user override screen (/admin/access) read through
 * this so they show the SAME active + coming-soon module list, in the same
 * order. No duplication of the merge logic.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlatformModules } from '@/src/shared/cms/platform-modules';
import { deriveModuleFeatureRows, type LiveModuleInput } from './moduleCatalog';

const isModuleKey = (k: string): boolean => /^module_\d+$/.test(k);

/** A merged catalog row: either a live module row or a catalog feature row. */
export interface MergedFeatureRow {
  feature_key: string;
  label: string;
  category: string;
  feature_type: 'gate' | 'limit' | 'metered';
  build_status: 'live' | 'in_development' | 'stub' | 'needs_build';
  display_order: number;
  moduleStatus?: 'live' | 'coming_soon' | 'pro' | 'enterprise';
}

export interface MergedCatalog {
  migrationApplied: boolean;
  error?: string;
  features: MergedFeatureRow[];
}

/**
 * Load the active features_registry rows and merge in the LIVE module rows from
 * the platform_modules registry (hidden dropped, coming-soon tagged). If the
 * entitlement tables are absent, returns migrationApplied:false with an empty
 * list instead of throwing, so the caller can surface a clear notice.
 */
export async function loadMergedFeatures(sb: SupabaseClient, platform: string): Promise<MergedCatalog> {
  const { data: features, error: fErr } = await sb
    .from('features_registry')
    .select('feature_key, label, category, feature_type, build_status, display_order, active')
    .eq('active', true)
    .order('display_order');

  if (fErr) {
    const notApplied = /relation .* does not exist|features_registry/i.test(fErr.message);
    return { migrationApplied: !notApplied, error: fErr.message, features: [] };
  }

  const nonModuleFeatures = (features ?? []).filter((f: { feature_key: string }) => !isModuleKey(f.feature_key));
  const liveModules = await getPlatformModules(platform);
  let moduleRows: MergedFeatureRow[];
  if (liveModules.length > 0) {
    moduleRows = deriveModuleFeatureRows(liveModules as unknown as LiveModuleInput[]) as unknown as MergedFeatureRow[];
  } else {
    // Fallback: the catalog's own module rows (keeps display order < non-module).
    moduleRows = (features ?? [])
      .filter((f: { feature_key: string }) => isModuleKey(f.feature_key))
      .map((f: Record<string, unknown>) => ({ ...f, category: 'module' })) as unknown as MergedFeatureRow[];
  }

  return { migrationApplied: true, features: [...moduleRows, ...nonModuleFeatures] };
}
