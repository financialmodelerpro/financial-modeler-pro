/**
 * shared/ai/features.ts (SERVER ONLY)
 *
 * Built-in AI feature registrations.
 *
 * A feature has to be IN the registry before it can be metered or toggled, so
 * every AI call site declares itself here. Registration is idempotent and
 * refreshes the definition only: an admin's toggle and caps are never clobbered
 * (see registryTypes.buildAiFeatureUpdate).
 *
 * The module-level `registered` set makes this a no-op after the first call in
 * a warm serverless instance, so a hot path pays two queries once rather than
 * on every request.
 *
 * Platform-agnostic features use AI_PLATFORM_ALL. A platform's own features
 * (the REFM IC narrative, for instance) register from that platform's folder
 * with its own slug.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { registerAiFeature } from './registry';
import { AI_PLATFORM_ALL, type AiFeatureInput } from './registryTypes';

/**
 * The admin newsletter rewriter. Cross-platform: it belongs to the main site's
 * admin tooling, not to a modeling platform.
 *
 * Grounding is 'context' rather than 'model': it is handed the draft to rewrite
 * and has no access to computed project figures.
 *
 * Caps are seeded from DEFAULT_AI_MONTHLY_CAPS at creation and are the admin's
 * to change afterwards. It registers DISABLED, like every feature, so turning
 * it on is a deliberate act in the panel.
 */
export const NEWSLETTER_ENHANCE_FEATURE: AiFeatureInput = {
  featureId: 'newsletter_enhance',
  platformSlug: AI_PLATFORM_ALL,
  name: 'Newsletter rewriter',
  description: 'Rewrites a newsletter draft to be clearer and more concise. Admin tool, in the Communications Hub.',
  category: 'generation',
  grounding: ['context'],
  displayOrder: 10,
};

const BUILT_IN: AiFeatureInput[] = [NEWSLETTER_ENHANCE_FEATURE];

/** Registered in this process already. Keyed platform::featureId. */
const registered = new Set<string>();

/**
 * Ensure a built-in feature exists in the registry. Safe to call on every
 * request: it does nothing after the first success in a warm instance.
 *
 * Failure is NOT fatal and NOT swallowed silently: it logs and returns false,
 * and the caller still meters. Metering denies an unregistered feature, so a
 * registration failure fails closed rather than opening the gate.
 */
export async function ensureAiFeature(input: AiFeatureInput, sb?: SupabaseClient): Promise<boolean> {
  const key = `${input.platformSlug}::${input.featureId}`;
  if (registered.has(key)) return true;

  const res = await registerAiFeature(input, sb);
  if (!res.ok) {
    console.error('[ai-features] registration failed:', { key, kind: res.kind, errors: res.errors });
    return false;
  }
  registered.add(key);
  return true;
}

/** Register every built-in feature. Used by a bootstrap or an admin refresh. */
export async function ensureBuiltInAiFeatures(sb?: SupabaseClient): Promise<void> {
  for (const f of BUILT_IN) await ensureAiFeature(f, sb);
}

/** Test seam: forget what this process has registered. */
export function resetAiFeatureRegistrationCache(): void {
  registered.clear();
}
