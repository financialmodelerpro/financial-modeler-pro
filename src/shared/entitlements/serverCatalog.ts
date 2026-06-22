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
  /** Customer-facing visibility (mig 164). Module rows are always true (their
   *  visibility is the Modules tab); non-module rows reflect features_registry.
   *  visible. Display-only: never affects gating. */
  visible: boolean;
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
  // Try with the mig-164 `visible` column; fall back to base cols + visible:true
  // so the catalog still loads before the migration is applied.
  let features: Record<string, unknown>[] | null = null;
  const full = await sb
    .from('features_registry')
    .select('feature_key, label, category, feature_type, build_status, display_order, active, visible')
    .eq('active', true)
    .order('display_order');
  if (!full.error) {
    features = full.data as Record<string, unknown>[];
  } else if (/relation .* does not exist|features_registry/i.test(full.error.message) && !/visible/i.test(full.error.message)) {
    return { migrationApplied: false, error: full.error.message, features: [] };
  } else {
    const base = await sb
      .from('features_registry')
      .select('feature_key, label, category, feature_type, build_status, display_order, active')
      .eq('active', true)
      .order('display_order');
    if (base.error) {
      const notApplied = /relation .* does not exist|features_registry/i.test(base.error.message);
      return { migrationApplied: !notApplied, error: base.error.message, features: [] };
    }
    features = (base.data ?? []).map((f: Record<string, unknown>) => ({ ...f, visible: true }));
  }

  const nonModuleFeatures = (features ?? [])
    .filter((f) => !isModuleKey(f.feature_key as string))
    .map((f) => ({ ...f, visible: f.visible !== false })) as unknown as MergedFeatureRow[];
  const liveModules = await getPlatformModules(platform);
  let moduleRows: MergedFeatureRow[];
  if (liveModules.length > 0) {
    // Module rows are always customer-visible here (their visibility = Modules tab).
    moduleRows = deriveModuleFeatureRows(liveModules as unknown as LiveModuleInput[])
      .map((m) => ({ ...m, visible: true })) as unknown as MergedFeatureRow[];
  } else {
    moduleRows = (features ?? [])
      .filter((f) => isModuleKey(f.feature_key as string))
      .map((f) => ({ ...f, category: 'module', visible: true })) as unknown as MergedFeatureRow[];
  }

  return { migrationApplied: true, features: [...moduleRows, ...nonModuleFeatures] };
}
