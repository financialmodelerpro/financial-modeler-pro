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
  /** Short blurb shown as the pricing-comparison info popover (mig 168), edited
   *  in the Plan Builder. Sourced from features_registry by feature_key for BOTH
   *  module and non-module rows. Display-only; null = none. */
  description: string | null;
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
  // Layered, migration-tolerant load: try the newest shape (visible + mig-168
  // description), then visible-only, then the base columns. Each fallback pads
  // the missing columns so the catalog still loads before a migration lands. A
  // genuine "table missing" only triggers migrationApplied:false on the BASE
  // select, so a missing optional column never reads as "not applied".
  let features: Record<string, unknown>[] | null = null;

  const withDesc = await sb
    .from('features_registry')
    .select('feature_key, label, category, feature_type, build_status, display_order, active, visible, description')
    .eq('active', true)
    .order('display_order');
  if (!withDesc.error) {
    features = withDesc.data as Record<string, unknown>[];
  } else {
    const withVisible = await sb
      .from('features_registry')
      .select('feature_key, label, category, feature_type, build_status, display_order, active, visible')
      .eq('active', true)
      .order('display_order');
    if (!withVisible.error) {
      features = (withVisible.data ?? []).map((f: Record<string, unknown>) => ({ ...f, description: null }));
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
      features = (base.data ?? []).map((f: Record<string, unknown>) => ({ ...f, visible: true, description: null }));
    }
  }

  // Descriptions key off features_registry for EVERY row (module + non-module),
  // so a module row derived live from the registry still picks up its blurb.
  const descByKey = new Map<string, string | null>();
  for (const f of features ?? []) {
    descByKey.set(f.feature_key as string, (f.description as string | null) ?? null);
  }

  const nonModuleFeatures = (features ?? [])
    .filter((f) => !isModuleKey(f.feature_key as string))
    .map((f) => ({ ...f, visible: f.visible !== false, description: (f.description as string | null) ?? null })) as unknown as MergedFeatureRow[];
  const liveModules = await getPlatformModules(platform);
  let moduleRows: MergedFeatureRow[];
  if (liveModules.length > 0) {
    // Module rows are always customer-visible here (their visibility = Modules tab).
    // Description still comes from the matching features_registry row.
    moduleRows = deriveModuleFeatureRows(liveModules as unknown as LiveModuleInput[])
      .map((m) => ({ ...m, visible: true, description: descByKey.get(m.feature_key) ?? null })) as unknown as MergedFeatureRow[];
  } else {
    moduleRows = (features ?? [])
      .filter((f) => isModuleKey(f.feature_key as string))
      .map((f) => ({ ...f, category: 'module', visible: true, description: (f.description as string | null) ?? null })) as unknown as MergedFeatureRow[];
  }

  return { migrationApplied: true, features: [...moduleRows, ...nonModuleFeatures] };
}
