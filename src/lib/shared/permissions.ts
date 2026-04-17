/**
 * permissions.ts - Server-side permission resolution.
 *
 * Two-level lookup:
 *   1. user_permissions  - per-user overrides set by admin
 *   2. plan_permissions  - plan-level defaults
 *   3. Default: false
 *
 * Import in API routes only. Never import in client components.
 */

import { getServerClient } from '@/src/lib/shared/supabase';
import type { FeatureKey, PermissionCache } from '@/src/types/subscription.types';

/**
 * Check a single feature for one user.
 * Checks user override first, then plan default, then returns false.
 */
export async function canAccess(
  userId: string,
  plan: string,
  featureKey: FeatureKey | string,
): Promise<boolean> {
  const db = getServerClient();

  // 1. User-level override
  const { data: override } = await db
    .from('user_permissions')
    .select('override_value')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (override !== null && override !== undefined) {
    return (override as { override_value: boolean }).override_value;
  }

  // 2. Plan-level default
  const { data: planPerm } = await db
    .from('plan_permissions')
    .select('enabled')
    .eq('plan', plan)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (planPerm !== null && planPerm !== undefined) {
    return (planPerm as { enabled: boolean }).enabled;
  }

  // 3. Default: deny
  return false;
}

/**
 * Load ALL permissions for a user in a single round-trip pair.
 * Returns a merged flat map: featureKey → boolean.
 * User overrides win over plan defaults.
 */
export async function loadUserPermissions(
  userId: string,
  plan: string,
): Promise<PermissionCache> {
  const db = getServerClient();

  const [planResult, userResult] = await Promise.all([
    db.from('plan_permissions')
      .select('feature_key, enabled')
      .eq('plan', plan),
    db.from('user_permissions')
      .select('feature_key, override_value')
      .eq('user_id', userId),
  ]);

  const merged: PermissionCache = {};

  for (const row of (planResult.data ?? []) as Array<{ feature_key: FeatureKey; enabled: boolean }>) {
    merged[row.feature_key] = row.enabled;
  }
  for (const row of (userResult.data ?? []) as Array<{ feature_key: FeatureKey; override_value: boolean }>) {
    merged[row.feature_key] = row.override_value;
  }

  return merged;
}

/**
 * Load the full plan × feature matrix for admin display.
 * Returns features list + nested map: plan → featureKey → enabled.
 */
export async function loadPermissionsMatrix(): Promise<{
  features: Array<{ feature_key: string; display_name: string; description: string | null; category: string }>;
  matrix: Record<string, Record<string, boolean>>;
}> {
  const db = getServerClient();

  const [featuresResult, planPermsResult] = await Promise.all([
    db.from('features_registry').select('feature_key, display_name, description, category').order('category').order('feature_key'),
    db.from('plan_permissions').select('plan, feature_key, enabled'),
  ]);

  const matrix: Record<string, Record<string, boolean>> = {
    free: {}, professional: {}, enterprise: {},
  };

  for (const row of (planPermsResult.data ?? []) as Array<{ plan: string; feature_key: string; enabled: boolean }>) {
    if (!matrix[row.plan]) matrix[row.plan] = {};
    matrix[row.plan][row.feature_key] = row.enabled;
  }

  return {
    features: (featuresResult.data ?? []) as Array<{ feature_key: string; display_name: string; description: string | null; category: string }>,
    matrix,
  };
}

/**
 * Set a plan-level permission. Admin only.
 * Creates the row if it doesn't exist, updates if it does.
 */
export async function setPlanPermission(
  plan: string,
  featureKey: string,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  const db = getServerClient();
  await db.from('plan_permissions').upsert(
    { plan, feature_key: featureKey, enabled, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'plan,feature_key' },
  );
}

/**
 * Set a user-level override. Admin only.
 * Pass override_value=null to delete the override.
 */
export async function setUserPermissionOverride(
  userId: string,
  featureKey: string,
  overrideValue: boolean | null,
  reason: string | null,
  createdBy: string,
): Promise<void> {
  const db = getServerClient();

  if (overrideValue === null) {
    await db.from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('feature_key', featureKey);
  } else {
    await db.from('user_permissions').upsert(
      { user_id: userId, feature_key: featureKey, override_value: overrideValue, reason, created_by: createdBy },
      { onConflict: 'user_id,feature_key' },
    );
  }
}
