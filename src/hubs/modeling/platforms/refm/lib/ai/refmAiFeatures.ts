/**
 * refm/lib/ai/refmAiFeatures.ts (SERVER ONLY)
 *
 * REFM's AI feature registrations.
 *
 * Lives in the platform folder, not in src/shared/ai/, for the same reason the
 * model grounding adapter does: the shared foundation must not import a
 * platform, or ERM cannot reuse it. Anything that needs BOTH (the admin panel
 * route, a future generation route) composes them at the app layer.
 *
 * Registration is idempotent and refreshes the DEFINITION only. An admin's
 * toggle and edited caps are never clobbered, so a deploy cannot silently
 * re-disable a feature that was turned on, or reset a cap that was lowered.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAiFeature } from '@/src/shared/ai/features';
import type { AiFeatureInput } from '@/src/shared/ai/registryTypes';

/** REFM's platform slug. NOT 'refm', which is the shortName: every
 *  platform-scoped table in this codebase keys on 'real-estate', and the admin
 *  panel resolves its group label from the platform catalog by this slug. */
export const REFM_PLATFORM_SLUG = 'real-estate';

/**
 * Module 7 IC narrative generation. The first REFM AI feature and the one the
 * foundation was built for.
 *
 * category 'narrative': it interprets figures the model already computed. It
 * creates no new facts, which is the whole premise of the grounding rules.
 *
 * grounding ['model']: the project's own computed numbers and nothing else. No
 * external market data (that is category 2, and the external provider reports
 * unavailable until a source is wired), and no application context.
 *
 * Caps are NOT specified here. Seeding applies DEFAULT_AI_MONTHLY_CAPS across
 * the platform's ACTIVE plans, which currently yields trial 5, pro 100, firm
 * 500. Restating those numbers here would create a second source that could
 * drift from the shared default; the verifier asserts the seeded result
 * instead. After seeding, the database row is authoritative and the admin panel
 * owns it.
 *
 * Registers DISABLED, like every feature, so switching it on is a deliberate
 * act in /admin/ai-features rather than a side effect of a deploy.
 */
export const IC_NARRATIVE_FEATURE: AiFeatureInput = {
  featureId: 'm7_ic_narrative',
  platformSlug: REFM_PLATFORM_SLUG,
  name: 'IC narrative',
  description:
    'Drafts the investment committee narrative from the project\'s computed figures: thesis, recommendation, risks and mitigants, returns commentary. Output is an editable draft, never auto-saved.',
  category: 'narrative',
  grounding: ['model'],
  displayOrder: 1,
};

const REFM_FEATURES: AiFeatureInput[] = [IC_NARRATIVE_FEATURE];

/**
 * Ensure every REFM AI feature exists in the registry.
 *
 * Called by the admin panel before it lists, so a feature declared in code
 * appears in the panel WITHOUT waiting for its generation route to be built.
 * That is what makes "new features appear here automatically" true rather than
 * true-once-someone-uses-it.
 *
 * Idempotent and memoised per process by ensureAiFeature, so repeated calls
 * cost nothing after the first success.
 */
export async function ensureRefmAiFeatures(sb?: SupabaseClient): Promise<void> {
  for (const f of REFM_FEATURES) await ensureAiFeature(f, sb);
}
