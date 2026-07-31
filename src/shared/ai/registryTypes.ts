/**
 * shared/ai/registryTypes.ts
 *
 * PURE layer of the AI feature registry (Unit 2). Types, constants, validation,
 * coercion of untrusted database rows, and the payload builders the DB layer
 * writes with. No SDK import, no Supabase import, no env read, so this module
 * is unit-testable and safe to import from anywhere.
 *
 * The registry is the single source of truth for every AI feature: its id,
 * name, category, owning platform, grounding type(s), on/off state, and its
 * per-plan monthly caps. src/shared/ai/registry.ts is the DB half.
 *
 * Two properties are load-bearing and deliberately expressed as SEPARATE pure
 * builders rather than one upsert payload:
 *
 *   buildAiFeatureInsert  - used when the feature row does not exist yet.
 *                           Carries `enabled` (off by default).
 *   buildAiFeatureUpdate  - used when it already exists. DEFINITION FIELDS
 *                           ONLY. It must never carry `enabled`, because
 *                           re-registering a feature (which happens on every
 *                           deploy that calls registerAiFeature) would then
 *                           silently undo an admin's toggle.
 *
 * Caps work the same way: they are seeded on CREATE only. An admin's edited cap
 * is never overwritten by a later registration.
 *
 * Platform-agnostic by construction: nothing here knows about REFM.
 *
 * No em dashes in this file.
 */

import { KNOWN_PLAN_KEYS } from '@/src/shared/entitlements/gate';

// -- Taxonomy ---------------------------------------------------------------

/**
 * The four AI feature categories from the foundation guideline. Fixed
 * taxonomy, matched by a CHECK constraint in migration 203, so extending it is
 * a deliberate migration rather than an accidental typo.
 */
export const AI_FEATURE_CATEGORIES = ['narrative', 'validation', 'guidance', 'generation'] as const;
export type AiFeatureCategory = typeof AI_FEATURE_CATEGORIES[number];
export function isAiFeatureCategory(v: unknown): v is AiFeatureCategory {
  return typeof v === 'string' && (AI_FEATURE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * What a feature is grounded in.
 *
 *   model    - the project's own computed numbers. No outside data.
 *   external - outside benchmark or market data (assumption validation).
 *   context  - where the user is and what they are doing (module, model state).
 *
 * A feature declares one or MORE: generation features are grounded in the model
 * and the context together, so a single-value field would have been wrong on
 * day one. Unit 4 (grounding abstraction) reads this to decide which context
 * providers to run.
 */
export const AI_GROUNDING_TYPES = ['model', 'external', 'context'] as const;
export type AiGrounding = typeof AI_GROUNDING_TYPES[number];
export function isAiGrounding(v: unknown): v is AiGrounding {
  return typeof v === 'string' && (AI_GROUNDING_TYPES as readonly string[]).includes(v);
}

/**
 * Reserved platform slug for a feature that belongs to every platform rather
 * than one of them. Real platform slugs come from the platform catalog
 * (real-estate, equity-research, ...); this registry never hardcodes them.
 */
export const AI_PLATFORM_ALL = 'all';

// -- Caps -------------------------------------------------------------------

/**
 * Default monthly generation caps applied when a feature is FIRST registered.
 * Admin-editable afterwards (Unit 5); these are only a starting point.
 *
 * trial / pro / firm come from the guideline. `solo` is not in that table (the
 * active paid plans are pro and firm) but the plan exists in entitlement_plans,
 * so it gets a deliberate starting value between trial and pro rather than
 * being silently left uncapped.
 */
export const DEFAULT_AI_MONTHLY_CAPS: Readonly<Record<string, number>> = Object.freeze({
  trial: 5,
  solo: 25,
  pro: 100,
  firm: 500,
});

/**
 * Cap given to a plan key that has no default of its own (a plan an admin
 * created after this code was written). ZERO on purpose: an unrecognised plan
 * must not get unmetered AI spend by accident. The admin raises it in the panel.
 *
 * Note this is the opposite direction to the entitlement gate's unknown-plan
 * safety net, which PRESERVES access. That asymmetry is intentional: losing
 * access to a module is a support ticket, an uncapped paid API is a bill.
 */
export const FALLBACK_AI_MONTHLY_CAP = 0;

/** The plan keys a fresh registration seeds caps for when the live plan list
 *  cannot be read. Reuses the entitlement layer's canonical list so plan keys
 *  are defined in exactly one place. */
export const DEFAULT_AI_CAP_PLAN_KEYS: readonly string[] = KNOWN_PLAN_KEYS;

// -- The feature ------------------------------------------------------------

/** A registered AI feature, as read back out of the registry. */
export interface AiFeature {
  /** Row uuid. Metering (Unit 3) references this. */
  id: string;
  /** Stable code-level id, e.g. 'm7_ic_narrative'. What code registers against. */
  featureId: string;
  /** Owning platform slug, or AI_PLATFORM_ALL for a cross-platform feature. */
  platformSlug: string;
  name: string;
  description: string | null;
  category: AiFeatureCategory;
  /** One or more grounding types. Never empty. */
  grounding: AiGrounding[];
  /** Master on/off. A disabled feature must not call the model. */
  enabled: boolean;
  displayOrder: number;
  /** plan_key -> monthly generation cap. A plan absent from this map has NO
   *  configured cap; see resolveAiCap. */
  caps: Record<string, number>;
}

/** What a feature supplies when it registers itself. */
export interface AiFeatureInput {
  featureId: string;
  /** Required and explicit: pass AI_PLATFORM_ALL for a cross-platform feature
   *  rather than letting a default guess for you. */
  platformSlug: string;
  name: string;
  description?: string | null;
  category: AiFeatureCategory;
  grounding: AiGrounding[];
  displayOrder?: number;
  /** Caps seeded at CREATE time only, merged over DEFAULT_AI_MONTHLY_CAPS.
   *  Never overwrites an existing (admin-edited) cap. */
  defaultCaps?: Record<string, number>;
  /** Whether the feature starts ON. Applies at CREATE time only, and defaults
   *  to false so a new AI feature can never begin spending unattended. */
  enabledOnCreate?: boolean;
}

/** A validated, normalised input. Only this shape reaches the DB layer. */
export interface NormalizedAiFeatureInput {
  featureId: string;
  platformSlug: string;
  name: string;
  description: string | null;
  category: AiFeatureCategory;
  grounding: AiGrounding[];
  displayOrder: number;
  defaultCaps: Record<string, number>;
  enabledOnCreate: boolean;
}

export type AiFeatureValidation =
  | { ok: true; value: NormalizedAiFeatureInput }
  | { ok: false; errors: string[] };

// -- Normalisation and validation -------------------------------------------

/** Canonical form of a feature id: trimmed, lower case, and restricted to
 *  [a-z0-9_]. Returns null when nothing usable is left, so a caller can report
 *  a clear error instead of writing a junk key. */
export function normalizeFeatureId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) return null;
  return id;
}

/** Canonical form of a platform slug: trimmed, lower case, [a-z0-9-]. */
export function normalizePlatformSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) return null;
  return slug;
}

/** Deduplicate while preserving declaration order. */
function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Validate and normalise a registration. Returns every problem at once rather
 * than the first, so a caller fixing a definition sees the whole list.
 */
export function validateAiFeatureInput(input: AiFeatureInput): AiFeatureValidation {
  const errors: string[] = [];

  const featureId = normalizeFeatureId(input?.featureId);
  if (!featureId) errors.push('featureId must be lower snake case and start with a letter.');

  const platformSlug = normalizePlatformSlug(input?.platformSlug);
  if (!platformSlug) errors.push('platformSlug is required (use AI_PLATFORM_ALL for a cross-platform feature).');

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('name is required.');

  if (!isAiFeatureCategory(input?.category)) {
    errors.push(`category must be one of: ${AI_FEATURE_CATEGORIES.join(', ')}.`);
  }

  // Unsupported values and duplicates are different problems: a repeated
  // 'model' is harmless and gets deduped, an unknown 'market' is a definition
  // error the caller must see. Comparing deduped length against raw length
  // would conflate the two.
  const groundingRaw = Array.isArray(input?.grounding) ? input.grounding : [];
  const unsupported = groundingRaw.filter((g) => !isAiGrounding(g));
  const grounding = uniq(groundingRaw.filter(isAiGrounding));
  if (unsupported.length > 0) {
    errors.push(`grounding contains an unsupported value (${unsupported.join(', ')}); allowed: ${AI_GROUNDING_TYPES.join(', ')}.`);
  }
  if (grounding.length === 0) {
    errors.push(`grounding must list at least one of: ${AI_GROUNDING_TYPES.join(', ')}.`);
  }

  const displayOrder = input?.displayOrder ?? 0;
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    errors.push('displayOrder must be a non-negative integer.');
  }

  const defaultCaps: Record<string, number> = {};
  for (const [plan, cap] of Object.entries(input?.defaultCaps ?? {})) {
    if (!Number.isInteger(cap) || cap < 0) {
      errors.push(`defaultCaps.${plan} must be a non-negative integer.`);
      continue;
    }
    defaultCaps[plan] = cap;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      featureId: featureId as string,
      platformSlug: platformSlug as string,
      name,
      description: typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null,
      category: input.category,
      grounding,
      displayOrder,
      defaultCaps,
      enabledOnCreate: input.enabledOnCreate === true,
    },
  };
}

// -- Payload builders -------------------------------------------------------

/**
 * Row written when the feature does not exist yet. Carries `enabled`, which is
 * the ONLY moment that column is ever written by registration.
 */
export function buildAiFeatureInsert(v: NormalizedAiFeatureInput): Record<string, unknown> {
  return {
    feature_id: v.featureId,
    platform_slug: v.platformSlug,
    name: v.name,
    description: v.description,
    category: v.category,
    grounding: v.grounding,
    enabled: v.enabledOnCreate,
    display_order: v.displayOrder,
  };
}

/**
 * Patch written when the feature already exists: DEFINITION FIELDS ONLY.
 *
 * `enabled` is absent by design. Registration runs whenever the code that owns
 * the feature loads, so including it would silently re-disable a feature the
 * admin had just turned on. Same reason caps are not touched here.
 */
export function buildAiFeatureUpdate(v: NormalizedAiFeatureInput): Record<string, unknown> {
  return {
    name: v.name,
    description: v.description,
    category: v.category,
    grounding: v.grounding,
    display_order: v.displayOrder,
  };
}

/**
 * The cap rows to seed for a brand new feature: one per known plan, taking the
 * feature's own default where it gives one, then the global default, then the
 * deliberate zero fallback for a plan nobody has set a value for.
 */
export function defaultCapsForPlans(
  planKeys: readonly string[],
  overrides: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plan of planKeys) {
    if (!plan) continue;
    out[plan] = overrides[plan] ?? DEFAULT_AI_MONTHLY_CAPS[plan] ?? FALLBACK_AI_MONTHLY_CAP;
  }
  // A feature may declare a cap for a plan that is not in the live plan list
  // (a plan added later, or one only that platform uses). Keep it rather than
  // dropping the admin's stated intent.
  for (const [plan, cap] of Object.entries(overrides)) {
    if (out[plan] === undefined) out[plan] = cap;
  }
  return out;
}

// -- Reading ----------------------------------------------------------------

/**
 * The configured monthly cap for one plan on one feature, or null when no cap
 * row exists for that plan.
 *
 * null is NOT zero and must not be quietly treated as either "unlimited" or
 * "blocked" here. Unit 3 owns that policy decision; this layer only reports
 * what is configured.
 */
export function resolveAiCap(feature: Pick<AiFeature, 'caps'>, planKey: string): number | null {
  const cap = feature.caps?.[planKey];
  return typeof cap === 'number' && Number.isFinite(cap) ? cap : null;
}

/** Read a text[] column back out of an untrusted row. Tolerates the array
 *  shape supabase-js returns and a comma separated string, which is what a
 *  hand-written SQL insert can leave behind. */
function readGrounding(raw: unknown): AiGrounding[] {
  const parts: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
      : [];
  return uniq(parts.filter(isAiGrounding));
}

/**
 * Turn one untrusted database row into an AiFeature, or null if it cannot be
 * trusted (unknown category, no valid grounding, missing id).
 *
 * Returning null rather than patching a default is deliberate: a row that does
 * not satisfy the contract is a row someone hand-edited, and quietly repairing
 * it into, say, category 'narrative' would hide the damage. The caller counts
 * the skips so they surface in the admin panel later.
 */
export function coerceAiFeatureRow(row: unknown, caps: Record<string, number> = {}): AiFeature | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  const id = typeof r.id === 'string' ? r.id : null;
  const featureId = normalizeFeatureId(r.feature_id);
  const platformSlug = normalizePlatformSlug(r.platform_slug);
  if (!id || !featureId || !platformSlug) return null;

  if (!isAiFeatureCategory(r.category)) return null;

  const grounding = readGrounding(r.grounding);
  if (grounding.length === 0) return null;

  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : featureId;
  const displayOrder = Number.isInteger(r.display_order) ? (r.display_order as number) : 0;

  const cleanCaps: Record<string, number> = {};
  for (const [plan, cap] of Object.entries(caps)) {
    if (typeof cap === 'number' && Number.isFinite(cap) && cap >= 0) cleanCaps[plan] = cap;
  }

  return {
    id,
    featureId,
    platformSlug,
    name,
    description: typeof r.description === 'string' && r.description.trim() ? r.description.trim() : null,
    category: r.category,
    grounding,
    enabled: r.enabled === true,
    displayOrder,
    caps: cleanCaps,
  };
}

/**
 * Whether a feature applies to a given platform. A feature registered under
 * AI_PLATFORM_ALL applies everywhere.
 */
export function featureAppliesToPlatform(feature: Pick<AiFeature, 'platformSlug'>, platformSlug: string): boolean {
  return feature.platformSlug === AI_PLATFORM_ALL || feature.platformSlug === platformSlug;
}

/** Stable ordering for any feature list: display order, then feature id. */
export function sortAiFeatures(features: AiFeature[]): AiFeature[] {
  return [...features].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.featureId.localeCompare(b.featureId),
  );
}
