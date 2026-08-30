/**
 * deleteUserAccount.ts (SERVER ONLY)
 *
 * THE single account-deletion engine, shared by the self-service route
 * (DELETE /api/user/account) and the admin route (DELETE /api/admin/users/[id]),
 * so what a deletion removes cannot depend on which door it came through.
 *
 * WHAT A DELETION REMOVES vs RETAINS (the decision, stated once):
 *
 *   REMOVED (hard delete):
 *     - the users row (identity, password hash, profile, tour state);
 *     - via existing FK cascades off users(id): the whole REFM project tree
 *       (refm_projects -> versions -> change_log, report decks + deck versions,
 *       fund terms, parties), user_permissions, trial_requests,
 *       ai_usage_counters, password_reset_tokens, refm_cost_catalog rows, and
 *       any enrollments / certificates / assessment_attempts keyed to this id;
 *     - explicitly (no FK exists, they would otherwise orphan):
 *       user_platform_subscriptions, subscription_email_log rows,
 *       trusted_devices rows for the user's email, and the avatar file
 *       (best effort).
 *
 *   RETAINED (deliberately):
 *     - payment_transactions: the revenue ledger /admin/revenue aggregates;
 *       deleting it would falsify recorded revenue;
 *     - manual_invoices + their stored PDFs: issued financial documents;
 *     - admin_audit_log rows: the ENGINE nulls target_user_id before the
 *       delete (the live FK is NO ACTION, not the SET NULL migration 007
 *       declares; probed 2026-08-30, aligned by mig 221), so the action
 *       records survive the user;
 *     - articles authored (author_id goes NULL by FK);
 *     - Training Hub roster records (training_* tables): a separate identity
 *       system keyed by email/registration id, NOT touched here;
 *     - one NEW account_deletions row (mig 219): who was deleted, by whom,
 *       when, the optional message, and a summary of what was removed.
 *
 *   REFUSED:
 *     - an admin account (demote first; protects against admin lockout);
 *     - a LIVE Paddle subscription unless the caller explicitly opted into
 *       cancelling it (cancelPaddle). When opted in, the subscription is
 *       cancelled at Paddle IMMEDIATELY and a cancel FAILURE ABORTS the whole
 *       deletion: a billing relationship must never outlive the account it
 *       bills, and never be silently orphaned;
 *     - an ADMIN-INITIATED deletion when the account_deletions table is absent
 *       (mig 219 not applied): an unauditable admin deletion does not proceed.
 *       A SELF deletion still proceeds with a loud log, because a user's right
 *       to delete their own account must not depend on our migration lag.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadPaymentSettings, providerConfigFrom, isLivePaddleSubscription,
  type PlatformSubscriptionRow,
} from '@/src/shared/payments/config';
import { cancelSubscriptionNow } from '@/src/shared/payments/paddleApi';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { accountDeletedEmail } from '@/src/shared/email/templates/subscription';

export interface DeletionPreview {
  userId: string;
  email: string;
  name: string | null;
  role: string | null;
  planKey: string | null;
  projects: number;
  versions: number;
  trialRequests: number;
  subscriptionRows: number;
  /** Live Paddle subscriptions that would have to be cancelled first. */
  liveSubscriptions: Array<{ platform: string; planKey: string | null; status: string | null }>;
  isAdmin: boolean;
}

export type DeleteAccountResult =
  | { ok: true; removed: RemovedSummary; messageEmailed: boolean; audited: boolean }
  | { ok: false; code: 'not_found' | 'admin_account' | 'active_subscription' | 'paddle_cancel_failed' | 'audit_unavailable' | 'delete_failed'; error: string };

export interface RemovedSummary {
  projects: number;
  versions: number;
  trialRequests: number;
  subscriptionRows: number;
  emailLogRows: number;
  trustedDevices: number;
  paddleCancelled: string[];
}

interface SubRowWithPlatform extends PlatformSubscriptionRow { platform_slug: string; }

async function loadUser(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from('users')
    .select('id, email, name, role, subscription_plan, avatar_url')
    .eq('id', userId).maybeSingle();
  return data as { id: string; email: string; name: string | null; role: string | null; subscription_plan: string | null; avatar_url: string | null } | null;
}

async function loadSubscriptionRows(sb: SupabaseClient, userId: string): Promise<SubRowWithPlatform[]> {
  try {
    const { data } = await sb.from('user_platform_subscriptions')
      .select('platform_slug, plan_key, source, status, paddle_subscription_id, paddle_customer_id, started_at, current_period_end, expires_at, amount_minor, currency, note')
      .eq('user_id', userId);
    return (data ?? []) as SubRowWithPlatform[];
  } catch {
    return [];
  }
}

/** Everything the confirmation dialogs state before a deletion: who, and what
 *  will be removed. Read-only. */
export async function previewAccountDeletion(sb: SupabaseClient, userId: string): Promise<DeletionPreview | null> {
  const user = await loadUser(sb, userId);
  if (!user) return null;

  const [{ data: projects }, subRows, trialReqCount] = await Promise.all([
    sb.from('refm_projects').select('id').eq('user_id', userId).range(0, 4999),
    loadSubscriptionRows(sb, userId),
    sb.from('trial_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId).then((r) => r.count ?? 0, () => 0),
  ]);
  const projectIds = ((projects ?? []) as Array<{ id: string }>).map((p) => p.id);
  let versions = 0;
  if (projectIds.length > 0) {
    const { count } = await sb.from('refm_project_versions').select('id', { count: 'exact', head: true }).in('project_id', projectIds);
    versions = count ?? 0;
  }
  const live = subRows.filter((r) => isLivePaddleSubscription(r));
  return {
    userId: user.id, email: user.email, name: user.name, role: user.role,
    planKey: user.subscription_plan,
    projects: projectIds.length, versions,
    trialRequests: trialReqCount,
    subscriptionRows: subRows.length,
    liveSubscriptions: live.map((r) => ({ platform: r.platform_slug, planKey: r.plan_key, status: r.status })),
    isAdmin: user.role === 'admin',
  };
}

export interface DeleteAccountOptions {
  userId: string;
  /** Who initiated it: the user themself, or an admin. */
  source: 'self' | 'admin';
  /** The admin's user id (source 'admin' only); recorded in the audit row. */
  deletedBy?: string | null;
  /** Optional message to the user, emailed after the deletion (admin flow). */
  message?: string | null;
  /** Explicit opt-in to cancelling a live Paddle subscription. Without it a
   *  live subscription REFUSES the deletion rather than orphaning billing. */
  cancelPaddle?: boolean;
}

export async function deleteUserAccount(sb: SupabaseClient, opts: DeleteAccountOptions): Promise<DeleteAccountResult> {
  const user = await loadUser(sb, opts.userId);
  if (!user) return { ok: false, code: 'not_found', error: 'User not found' };
  if (user.role === 'admin') {
    return { ok: false, code: 'admin_account', error: 'Admin accounts cannot be deleted. Change the role to user first.' };
  }

  // ── 1. A live Paddle subscription is handled EXPLICITLY, never orphaned ────
  const subRows = await loadSubscriptionRows(sb, opts.userId);
  const liveSubs = subRows.filter((r) => isLivePaddleSubscription(r));
  const paddleCancelled: string[] = [];
  if (liveSubs.length > 0) {
    if (!opts.cancelPaddle) {
      return {
        ok: false, code: 'active_subscription',
        error: 'This account has an active paid subscription. Deleting it will cancel the subscription immediately; confirm the cancellation to proceed.',
      };
    }
    for (const row of liveSubs) {
      try {
        const settings = await loadPaymentSettings(sb, row.platform_slug);
        const cfg = providerConfigFrom(settings, 'paddle');
        if (!cfg.apiKey) {
          return { ok: false, code: 'paddle_cancel_failed', error: `Paddle is not configured for ${row.platform_slug}; cannot cancel the live subscription, so the account was NOT deleted.` };
        }
        const res = await cancelSubscriptionNow(cfg, row.paddle_subscription_id!);
        if (!res.ok) {
          return { ok: false, code: 'paddle_cancel_failed', error: `Cancelling the Paddle subscription failed (${res.error}); the account was NOT deleted.` };
        }
        paddleCancelled.push(row.paddle_subscription_id!);
      } catch (e) {
        return { ok: false, code: 'paddle_cancel_failed', error: `Cancelling the Paddle subscription failed (${e instanceof Error ? e.message : 'error'}); the account was NOT deleted.` };
      }
    }
  }

  // ── 2. Count what is about to be removed (for the audit record) ────────────
  const preview = await previewAccountDeletion(sb, opts.userId);
  const removed: RemovedSummary = {
    projects: preview?.projects ?? 0,
    versions: preview?.versions ?? 0,
    trialRequests: preview?.trialRequests ?? 0,
    subscriptionRows: subRows.length,
    emailLogRows: 0,
    trustedDevices: 0,
    paddleCancelled,
  };

  // ── 3. Audit BEFORE the delete (the row must exist even if a later step
  //       fails half-way). Required for an admin deletion; best-effort with a
  //       loud log for self-service. ─────────────────────────────────────────
  let audited = false;
  {
    const { error } = await sb.from('account_deletions').insert({
      deleted_user_id: user.id,
      email: user.email,
      name: user.name,
      plan_key: user.subscription_plan,
      source: opts.source,
      deleted_by: opts.source === 'admin' ? (opts.deletedBy ?? null) : user.id,
      message: opts.message?.trim() ? opts.message.trim() : null,
      removed,
    });
    if (!error) {
      audited = true;
    } else if (opts.source === 'admin') {
      return {
        ok: false, code: 'audit_unavailable',
        error: `Deletion audit could not be recorded (${error.message}). Apply migration 219 (account_deletions); an unauditable admin deletion does not proceed.`,
      };
    } else {
      console.error('[account-delete] AUDIT ROW NOT WRITTEN for self-deletion of', user.email, ':', error.message);
    }
  }

  // ── 4. Explicit cleanup of the tables with NO users FK (would orphan) ──────
  // FIRST: null this user out of the audit log's TARGET column. The live
  // constraint admin_audit_log_target_user_id_fkey is ON DELETE NO ACTION
  // (probed 2026-08-30; migration 007's SET NULL never took effect, the table
  // predates it), so without this the users delete below is BLOCKED by any
  // audit row that ever named this user (every plan / role / status change
  // writes one). This IS the SET NULL the schema intended, done in code: the
  // audit rows SURVIVE the user with the target nulled, and this deletion's
  // own account_deletions row keeps the identity (raw id + email). Mig 221
  // aligns the constraint itself; this line keeps deletes working either way.
  {
    const { error } = await sb.from('admin_audit_log').update({ target_user_id: null }).eq('target_user_id', opts.userId);
    if (error) {
      // If this failed AND the constraint is still NO ACTION, the delete below
      // would fail anyway; abort with the precise reason instead.
      return { ok: false, code: 'delete_failed', error: `Could not release audit-log references (${error.message}); the account was NOT deleted.` };
    }
  }
  try {
    const { count } = await sb.from('user_platform_subscriptions').delete({ count: 'exact' }).eq('user_id', opts.userId);
    removed.subscriptionRows = count ?? removed.subscriptionRows;
  } catch { /* absent table: nothing to clean */ }
  try {
    // user_id is TEXT in subscription_email_log; the uuid matches as a string.
    const { count } = await sb.from('subscription_email_log').delete({ count: 'exact' }).eq('user_id', opts.userId);
    removed.emailLogRows = count ?? 0;
  } catch { /* absent table */ }
  try {
    const { count } = await sb.from('trusted_devices').delete({ count: 'exact' }).eq('identifier', user.email);
    removed.trustedDevices = count ?? 0;
  } catch { /* absent table */ }
  // Avatar file: best effort (the DB row cascade does not reach storage).
  try {
    const m = user.avatar_url?.match(/\/avatars\/(.+)$/);
    if (m) await sb.storage.from('avatars').remove([decodeURIComponent(m[1])]);
  } catch { /* best effort */ }

  // ── 5. The users row; FK cascades take the project tree and the rest ──────
  const { error: delErr } = await sb.from('users').delete().eq('id', opts.userId);
  if (delErr) {
    return { ok: false, code: 'delete_failed', error: delErr.message };
  }

  // ── 6. Notify the user (after the delete has actually happened) ────────────
  let messageEmailed = false;
  try {
    const { subject, html } = await accountDeletedEmail({
      name: user.name, message: opts.message ?? null, source: opts.source,
    });
    await sendEmail({ to: user.email, subject, html, from: FROM.noreply });
    messageEmailed = true;
  } catch (e) {
    console.warn('[account-delete] deletion email failed for', user.email, ':', e instanceof Error ? e.message : String(e));
  }
  if (audited) {
    try {
      await sb.from('account_deletions').update({ message_emailed: messageEmailed }).eq('deleted_user_id', user.id).eq('source', opts.source);
    } catch { /* best effort */ }
  }

  return { ok: true, removed, messageEmailed, audited };
}
