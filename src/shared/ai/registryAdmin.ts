/**
 * shared/ai/registryAdmin.ts (SERVER ONLY)
 *
 * Admin WRITE path for the AI feature registry (Unit 5).
 *
 * Deliberately separate from registry.ts. That module is the runtime read path
 * every AI feature calls, and Unit 2 left it with no setters on purpose so a
 * feature could not flip its own toggle or raise its own cap. Keeping the
 * writes here preserves that boundary: the only caller of this module is the
 * admin API route.
 *
 * What an admin can change:
 *   - enabled, the master on/off for a feature.
 *   - the per-plan monthly cap.
 *
 * What an admin CANNOT change here, on purpose:
 *   - the feature's identity, category, platform, or grounding. Those are
 *     declared by the code that owns the feature and refreshed on every
 *     registration, so editing them in the panel would be silently reverted at
 *     the next deploy. Config the admin owns is editable; contract the code
 *     owns is not.
 *
 * Enforcement lives server-side in the metering layer (Unit 3) and in whatever
 * consumes listEnabledAiFeatures. This module only edits config; it grants
 * nothing and blocks nothing by itself.
 *
 * Never throws: every outcome is a typed result, matching runAi and the
 * registry.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import { getAiFeature } from './registry';
import type { AiFeature } from './registryTypes';

const FEATURES_TABLE = 'ai_features';
const CAPS_TABLE = 'ai_feature_caps';

export type AiAdminResult =
  | { ok: true; feature: AiFeature }
  | { ok: false; kind: 'invalid' | 'not_found' | 'unavailable' | 'db'; errors: string[] };

/** Same missing-table detection the registry uses, so a pre-migration state
 *  reports "unavailable" rather than a 500. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST106') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(err.message ?? '');
}

// -- Pure validation --------------------------------------------------------

/**
 * A cap must be a non-negative integer.
 *
 * Zero is VALID and meaningful: it is how an admin denies a feature to a tier
 * without disabling it for everyone. There is deliberately no "unlimited"
 * sentinel here. The entitlement catalog uses -1 for unlimited on plan limits,
 * but an unlimited AI cap is an unbounded bill on a metered external API, so if
 * it is ever wanted it should be an explicit, separately named decision rather
 * than a magic number someone types into a box.
 */
export function isValidCap(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000;
}

export interface CapEdits { [planKey: string]: number }

/** Validate a whole cap edit set at once, reporting every problem rather than
 *  the first, so an admin fixing a row sees the full list. */
export function validateCapEdits(edits: CapEdits): { ok: true; value: CapEdits } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: CapEdits = {};

  for (const [plan, cap] of Object.entries(edits ?? {})) {
    const key = typeof plan === 'string' ? plan.trim() : '';
    if (!key) { errors.push('A cap was supplied with no plan key.'); continue; }
    if (!isValidCap(cap)) {
      errors.push(`Cap for "${key}" must be a whole number between 0 and 1,000,000.`);
      continue;
    }
    value[key] = cap;
  }

  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push('No caps were supplied.');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

// -- Writes -----------------------------------------------------------------

/**
 * Turn a feature on or off.
 *
 * Takes effect immediately: the registry reads the row on every call with no
 * cache in front of it, so the next runtime read sees the new value.
 */
export async function setAiFeatureEnabled(
  featureId: string,
  platformSlug: string,
  enabled: boolean,
  sb: SupabaseClient = getServerClient(),
): Promise<AiAdminResult> {
  if (typeof enabled !== 'boolean') {
    return { ok: false, kind: 'invalid', errors: ['enabled must be true or false.'] };
  }

  const res = await sb
    .from(FEATURES_TABLE)
    .update({ enabled })
    .eq('feature_id', featureId)
    .eq('platform_slug', platformSlug)
    .select('id');

  if (res.error) {
    const kind = isMissingTable(res.error) ? 'unavailable' : 'db';
    return { ok: false, kind, errors: [res.error.message] };
  }
  if (!res.data || res.data.length === 0) {
    return { ok: false, kind: 'not_found', errors: [`No AI feature "${featureId}" is registered for platform "${platformSlug}".`] };
  }

  const feature = await getAiFeature(featureId, platformSlug, sb);
  return feature
    ? { ok: true, feature }
    : { ok: false, kind: 'db', errors: ['The toggle was written but the feature could not be read back.'] };
}

/**
 * Set per-plan monthly caps.
 *
 * UPSERT, not update: a plan created after the feature was registered has no
 * cap row yet, and an admin setting its cap for the first time must create one
 * rather than silently doing nothing. Plans not named in the edit are left
 * exactly as they are, so editing one tier cannot disturb another.
 */
export async function setAiFeatureCaps(
  featureId: string,
  platformSlug: string,
  edits: CapEdits,
  sb: SupabaseClient = getServerClient(),
): Promise<AiAdminResult> {
  const validated = validateCapEdits(edits);
  if (!validated.ok) return { ok: false, kind: 'invalid', errors: validated.errors };

  // Resolve the row id first: caps are keyed by the feature's uuid, and this
  // also confirms the feature exists before writing anything.
  const row = await sb
    .from(FEATURES_TABLE)
    .select('id')
    .eq('feature_id', featureId)
    .eq('platform_slug', platformSlug)
    .limit(1);

  if (row.error) {
    const kind = isMissingTable(row.error) ? 'unavailable' : 'db';
    return { ok: false, kind, errors: [row.error.message] };
  }
  const aiFeatureId = ((row.data ?? [])[0] as { id?: string } | undefined)?.id;
  if (!aiFeatureId) {
    return { ok: false, kind: 'not_found', errors: [`No AI feature "${featureId}" is registered for platform "${platformSlug}".`] };
  }

  const rows = Object.entries(validated.value).map(([plan_key, monthly_cap]) => ({
    ai_feature_id: aiFeatureId,
    plan_key,
    monthly_cap,
  }));

  const res = await sb.from(CAPS_TABLE).upsert(rows, { onConflict: 'ai_feature_id,plan_key' });
  if (res.error) {
    const kind = isMissingTable(res.error) ? 'unavailable' : 'db';
    return { ok: false, kind, errors: [res.error.message] };
  }

  const feature = await getAiFeature(featureId, platformSlug, sb);
  return feature
    ? { ok: true, feature }
    : { ok: false, kind: 'db', errors: ['The caps were written but the feature could not be read back.'] };
}
