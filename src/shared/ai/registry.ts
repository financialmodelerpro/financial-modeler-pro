/**
 * shared/ai/registry.ts (SERVER ONLY)
 *
 * The AI feature registry: the single source of truth for every AI feature
 * across every platform (Unit 2 of the AI foundation).
 *
 * This is the DATABASE half. Every pure rule (validation, coercion, payload
 * shape, cap defaults) lives in registryTypes.ts, so the contract can be tested
 * without a database and the two halves cannot drift.
 *
 * Reads: listAiFeatures / getAiFeature.
 * Writes: registerAiFeature / registerAiFeatures, which a feature calls to
 *         declare itself. There is deliberately NO setEnabled or setCaps here:
 *         those are admin operations and belong to the admin panel (Unit 5).
 *
 * Three properties this module guarantees:
 *
 *   1. NEVER THROWS. Every outcome is a typed result, matching the runAi
 *      contract, so a caller branches on a union instead of wrapping each call
 *      in try/catch. A missing table is a reported state, not an exception.
 *
 *   2. MIGRATION TOLERANT. Production lags the repo, so a read before
 *      migration 203 lands returns migrationApplied:false with an empty list
 *      rather than a 500. Everything downstream can ship before the migration
 *      is applied.
 *
 *   3. REGISTRATION NEVER CLOBBERS ADMIN INTENT. Re-registering an existing
 *      feature updates its definition only. `enabled` and any cap an admin has
 *      edited are left exactly as they are. Caps are only ever ADDED (for a
 *      plan that has no row yet), never overwritten.
 *
 * Platform-agnostic: nothing here knows about REFM. A feature names its own
 * platform slug, or AI_PLATFORM_ALL.
 *
 * SERVER ONLY: uses the service-role Supabase client.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import {
  AI_PLATFORM_ALL,
  DEFAULT_AI_CAP_PLAN_KEYS,
  buildAiFeatureInsert,
  buildAiFeatureUpdate,
  coerceAiFeatureRow,
  defaultCapsForPlans,
  sortAiFeatures,
  validateAiFeatureInput,
  type AiFeature,
  type AiFeatureInput,
  type NormalizedAiFeatureInput,
} from './registryTypes';

const FEATURES_TABLE = 'ai_features';
const CAPS_TABLE = 'ai_feature_caps';

const FEATURE_COLUMNS =
  'id, feature_id, platform_slug, name, description, category, grounding, enabled, display_order';

/** Ceiling on rows fetched in one read. PostgREST caps a response at 1000 rows
 *  by default and TRUNCATES silently past it, so the bound is explicit. The
 *  registry is a handful of features times a handful of plans, so this is a
 *  guard rail rather than a real limit. */
const MAX_ROWS = 1000;

// -- Result types -----------------------------------------------------------

export interface AiRegistrySnapshot {
  /** False when migration 203 has not been applied yet. */
  migrationApplied: boolean;
  /** Present when something went wrong. Safe to log. */
  error?: string;
  features: AiFeature[];
  /** Rows the coercer refused (unknown category, no valid grounding). Non-zero
   *  means someone hand-edited the table; surfaced so it can be shown rather
   *  than silently swallowed. */
  skipped: number;
}

export type AiRegisterResult =
  | { ok: true; created: boolean; feature: AiFeature }
  | {
      ok: false;
      /** invalid = bad definition (a programming error, fix the call site).
       *  unavailable = the registry tables are not there yet.
       *  db = the database rejected the write. */
      kind: 'invalid' | 'unavailable' | 'db';
      errors: string[];
    };

// -- Internals --------------------------------------------------------------

/** Whether a Supabase error means "this table does not exist yet". Checks the
 *  Postgres undefined-table code and the PostgREST schema-cache code first, and
 *  only then the message, so a reworded error does not read as applied. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST106') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(err.message ?? '');
}

/** plan_key -> monthly_cap for the given feature row ids. A missing caps table
 *  yields empty maps rather than failing the whole read: a feature with no
 *  visible caps is still worth listing (and resolveAiCap reports null). */
async function loadCaps(
  sb: SupabaseClient,
  featureRowIds: string[],
): Promise<Record<string, Record<string, number>>> {
  const byFeature: Record<string, Record<string, number>> = {};
  if (featureRowIds.length === 0) return byFeature;

  const res = await sb
    .from(CAPS_TABLE)
    .select('ai_feature_id, plan_key, monthly_cap')
    .in('ai_feature_id', featureRowIds)
    .range(0, MAX_ROWS - 1);

  if (res.error || !res.data) return byFeature;

  for (const row of res.data as Record<string, unknown>[]) {
    const fid = typeof row.ai_feature_id === 'string' ? row.ai_feature_id : null;
    const plan = typeof row.plan_key === 'string' ? row.plan_key : null;
    const cap = row.monthly_cap;
    if (!fid || !plan || typeof cap !== 'number' || !Number.isFinite(cap)) continue;
    (byFeature[fid] ??= {})[plan] = cap;
  }
  return byFeature;
}

/**
 * The plan keys a fresh registration should seed caps for.
 *
 * Read LIVE from entitlement_plans rather than hardcoded, so a plan the admin
 * creates gets an AI cap without a code change. Falls back to the canonical
 * plan-key list when that table cannot be read, so registration never fails
 * because of it.
 */
async function loadPlanKeys(sb: SupabaseClient, platformSlug: string): Promise<string[]> {
  let q = sb.from('entitlement_plans').select('plan_key, platform_slug, active').eq('active', true);
  // A cross-platform feature seeds caps for every plan in the system; a
  // platform's own feature seeds only that platform's plans.
  if (platformSlug !== AI_PLATFORM_ALL) q = q.eq('platform_slug', platformSlug);

  const res = await q.range(0, MAX_ROWS - 1);
  if (res.error || !res.data) return [...DEFAULT_AI_CAP_PLAN_KEYS];

  const keys = Array.from(
    new Set(
      (res.data as Record<string, unknown>[])
        .map((r) => (typeof r.plan_key === 'string' ? r.plan_key.trim() : ''))
        .filter(Boolean),
    ),
  );
  return keys.length > 0 ? keys : [...DEFAULT_AI_CAP_PLAN_KEYS];
}

/** Assemble features + caps into the public snapshot shape. */
async function hydrate(
  sb: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<{ features: AiFeature[]; skipped: number }> {
  const ids = rows.map((r) => (typeof r.id === 'string' ? r.id : '')).filter(Boolean);
  const capsByFeature = await loadCaps(sb, ids);

  const features: AiFeature[] = [];
  let skipped = 0;
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : '';
    const feature = coerceAiFeatureRow(row, capsByFeature[id] ?? {});
    if (feature) features.push(feature);
    else skipped++;
  }
  return { features: sortAiFeatures(features), skipped };
}

// -- Reads ------------------------------------------------------------------

/**
 * Every registered AI feature, newest schema first and migration tolerant.
 *
 * @param platformSlug when given, returns that platform's features PLUS any
 *        registered under AI_PLATFORM_ALL. Omit for the whole registry (what
 *        the admin panel wants).
 */
export async function listAiFeatures(
  platformSlug?: string,
  sb: SupabaseClient = getServerClient(),
): Promise<AiRegistrySnapshot> {
  let q = sb.from(FEATURES_TABLE).select(FEATURE_COLUMNS).order('display_order').order('feature_id');
  if (platformSlug) q = q.in('platform_slug', [platformSlug, AI_PLATFORM_ALL]);

  const res = await q.range(0, MAX_ROWS - 1);
  if (res.error) {
    if (isMissingTable(res.error)) {
      return { migrationApplied: false, error: res.error.message, features: [], skipped: 0 };
    }
    return { migrationApplied: true, error: res.error.message, features: [], skipped: 0 };
  }

  const { features, skipped } = await hydrate(sb, (res.data ?? []) as Record<string, unknown>[]);
  return { migrationApplied: true, features, skipped };
}

/** Only the features that are switched ON for a platform. What a runtime caller
 *  (Unit 3 and up) should use: a disabled feature must never reach the model. */
export async function listEnabledAiFeatures(
  platformSlug?: string,
  sb: SupabaseClient = getServerClient(),
): Promise<AiRegistrySnapshot> {
  const snap = await listAiFeatures(platformSlug, sb);
  return { ...snap, features: snap.features.filter((f) => f.enabled) };
}

/**
 * One feature by its code id.
 *
 * Resolution order is exact platform first, then the cross-platform AI_PLATFORM_ALL
 * registration, so a platform can override a shared feature with its own.
 * Returns null when the feature is not registered OR the table is absent; use
 * listAiFeatures when the caller needs to tell those two apart.
 */
export async function getAiFeature(
  featureId: string,
  platformSlug: string,
  sb: SupabaseClient = getServerClient(),
): Promise<AiFeature | null> {
  const res = await sb
    .from(FEATURES_TABLE)
    .select(FEATURE_COLUMNS)
    .eq('feature_id', featureId)
    .in('platform_slug', [platformSlug, AI_PLATFORM_ALL])
    .limit(2);

  if (res.error || !res.data || res.data.length === 0) return null;

  const rows = res.data as Record<string, unknown>[];
  const exact = rows.find((r) => r.platform_slug === platformSlug) ?? rows[0];
  const { features } = await hydrate(sb, [exact]);
  return features[0] ?? null;
}

// -- Registration -----------------------------------------------------------

/** The raw row for one feature, or null. Used to decide insert vs update. */
async function findRow(
  sb: SupabaseClient,
  featureId: string,
  platformSlug: string,
): Promise<{ row: Record<string, unknown> | null; error: { code?: string; message?: string } | null }> {
  const res = await sb
    .from(FEATURES_TABLE)
    .select(FEATURE_COLUMNS)
    .eq('feature_id', featureId)
    .eq('platform_slug', platformSlug)
    .limit(1);
  if (res.error) return { row: null, error: res.error };
  return { row: ((res.data ?? [])[0] as Record<string, unknown>) ?? null, error: null };
}

/**
 * Seed cap rows for any plan that does not have one yet.
 *
 * INSERT-IF-ABSENT, never update: an admin's edited cap is untouchable from
 * code. Running this on every registration (not only on create) means a plan
 * added later picks up a sensible default on the next registration instead of
 * silently having none.
 *
 * A failure here is not fatal to registration: the feature is still registered
 * and resolveAiCap simply reports null for the plans that got no row.
 */
async function seedCaps(
  sb: SupabaseClient,
  aiFeatureRowId: string,
  v: NormalizedAiFeatureInput,
): Promise<void> {
  const planKeys = await loadPlanKeys(sb, v.platformSlug);
  const caps = defaultCapsForPlans(planKeys, v.defaultCaps);
  const rows = Object.entries(caps).map(([plan_key, monthly_cap]) => ({
    ai_feature_id: aiFeatureRowId,
    plan_key,
    monthly_cap,
  }));
  if (rows.length === 0) return;

  const res = await sb
    .from(CAPS_TABLE)
    .upsert(rows, { onConflict: 'ai_feature_id,plan_key', ignoreDuplicates: true });
  if (res.error) {
    console.error('[ai-registry] cap seed failed:', { featureId: v.featureId, message: res.error.message });
  }
}

/**
 * Register (or re-register) an AI feature.
 *
 * Idempotent and safe to call on every load of the module that owns the
 * feature. On an existing feature it refreshes the DEFINITION only: name,
 * description, category, grounding, order. It does not touch `enabled`, and it
 * does not overwrite an existing cap.
 */
export async function registerAiFeature(
  input: AiFeatureInput,
  sb: SupabaseClient = getServerClient(),
): Promise<AiRegisterResult> {
  const validated = validateAiFeatureInput(input);
  if (!validated.ok) {
    return { ok: false, kind: 'invalid', errors: validated.errors };
  }
  const v = validated.value;

  const existing = await findRow(sb, v.featureId, v.platformSlug);
  if (existing.error) {
    const kind = isMissingTable(existing.error) ? 'unavailable' : 'db';
    return { ok: false, kind, errors: [existing.error.message ?? 'Could not read the AI feature registry.'] };
  }

  let rowId: string;
  let created: boolean;

  if (existing.row) {
    rowId = existing.row.id as string;
    created = false;
    // Definition-only patch. buildAiFeatureUpdate deliberately omits `enabled`.
    const upd = await sb.from(FEATURES_TABLE).update(buildAiFeatureUpdate(v)).eq('id', rowId);
    if (upd.error) return { ok: false, kind: 'db', errors: [upd.error.message] };
  } else {
    const ins = await sb.from(FEATURES_TABLE).insert(buildAiFeatureInsert(v)).select('id').limit(1);
    if (ins.error) {
      const kind = isMissingTable(ins.error) ? 'unavailable' : 'db';
      return { ok: false, kind, errors: [ins.error.message] };
    }
    const insertedId = ((ins.data ?? [])[0] as Record<string, unknown> | undefined)?.id;
    if (typeof insertedId !== 'string') {
      return { ok: false, kind: 'db', errors: ['The registry insert returned no row id.'] };
    }
    rowId = insertedId;
    created = true;
  }

  await seedCaps(sb, rowId, v);

  const feature = await getAiFeature(v.featureId, v.platformSlug, sb);
  if (!feature) {
    return { ok: false, kind: 'db', errors: ['The feature was written but could not be read back.'] };
  }
  return { ok: true, created, feature };
}

/** Register several features. Every input is attempted, so one bad definition
 *  does not hide the rest; the caller gets a result per input in order. */
export async function registerAiFeatures(
  inputs: AiFeatureInput[],
  sb: SupabaseClient = getServerClient(),
): Promise<AiRegisterResult[]> {
  const out: AiRegisterResult[] = [];
  for (const input of inputs) {
    out.push(await registerAiFeature(input, sb));
  }
  return out;
}
