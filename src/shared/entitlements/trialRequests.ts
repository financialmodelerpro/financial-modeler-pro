/**
 * trialRequests.ts (server)
 *
 * The "Start free trial" flow for a logged-in user, plus the admin approval
 * queue. Two states, driven by ONE admin toggle:
 *
 *   - Approval OFF (default, self-serve): grant the trial immediately via the
 *     SHARED setUserPlan(..., 'trial'). No queue, no wait.
 *   - Approval ON: create a pending trial_requests row (snapshotting the user's
 *     company / job_title so approval is one click). An admin approves -> the
 *     SAME setUserPlan(..., 'trial') runs.
 *
 * The toggle is stored in cms_content (entitlements / trial_requires_approval),
 * so it needs no migration and is editable in the Plan Builder. trial_requests
 * (mig 173) is only touched on the approval path; if that table is absent the
 * approval path degrades to a clear error (the default self-serve path never
 * needs it). Plan-setting is NEVER duplicated; both paths call setUserPlan.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { setUserPlan } from './setUserPlan';
import { isUserLivePaddle, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';

export const TRIAL_APPROVAL_SECTION = 'entitlements';
export const TRIAL_APPROVAL_KEY = 'trial_requires_approval';

/** Read the admin toggle. Default false (self-serve). Tolerant of a missing row. */
export async function loadTrialRequiresApproval(sb: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await sb
      .from('cms_content').select('value')
      .eq('section', TRIAL_APPROVAL_SECTION).eq('key', TRIAL_APPROVAL_KEY)
      .maybeSingle();
    return (data as { value?: string } | null)?.value === 'true';
  } catch {
    return false;
  }
}

export type TrialActionResult =
  | { ok: true; status: 'granted'; trialEndsAt: string | null }
  | { ok: true; status: 'requested' }
  | { ok: false; status: 'error'; error: string; code?: string };

/**
 * Self-serve grant OR queue a request for the signed-in user, based on the
 * toggle. Reuses setUserPlan for the grant (no duplicated plan logic).
 */
export async function startTrialForUser(
  sb: SupabaseClient, userId: string, platform = 'real-estate',
): Promise<TrialActionResult> {
  if (!userId) return { ok: false, status: 'error', error: 'user_id required' };

  // A user already billed by Paddle must not self-move onto trial in the app
  // (the SAME guard the admin plan route uses), so Paddle is never left billing
  // a paid plan while the app shows trial.
  if (await isUserLivePaddle(sb, userId, platform)) {
    return { ok: false, status: 'error', error: PADDLE_BILLED_BLOCK_MESSAGE, code: 'paddle_billed' };
  }

  const requiresApproval = await loadTrialRequiresApproval(sb);

  if (!requiresApproval) {
    const res = await setUserPlan(sb, userId, 'trial', { platform });
    if (!res.ok) return { ok: false, status: 'error', error: res.error ?? 'grant_failed' };
    return { ok: true, status: 'granted', trialEndsAt: res.trialEndsAt ?? null };
  }

  // Approval required: snapshot the user's company/title onto a pending request.
  try {
    const { data: u } = await sb.from('users').select('company, job_title').eq('id', userId).maybeSingle();
    const company = (u as { company?: string | null } | null)?.company ?? null;
    const jobTitle = (u as { job_title?: string | null } | null)?.job_title ?? null;
    // Idempotent: one pending row per user (unique partial index). Upsert-like
    // behavior via delete-then-insert of the pending row keeps it simple.
    await sb.from('trial_requests').delete().eq('user_id', userId).eq('status', 'pending');
    const { error } = await sb.from('trial_requests').insert({
      user_id: userId, platform, status: 'pending', company, job_title: jobTitle,
    });
    if (error) return { ok: false, status: 'error', error: error.message };
    return { ok: true, status: 'requested' };
  } catch (e) {
    return { ok: false, status: 'error', error: e instanceof Error ? e.message : 'request_failed' };
  }
}
