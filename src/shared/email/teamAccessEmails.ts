/**
 * teamAccessEmails.ts (SERVER ONLY)
 *
 * TEAM ACCESS NOTIFICATIONS: a person is told by email when they are given
 * access to a project and when it is taken away, naming WHO did it, WHICH
 * project, and (for a grant) WHAT role they hold.
 *
 * ── THE CONTRACT WITH THE WRITE SITES ─────────────────────────────────────
 *
 * Every function here returns an outcome and NEVER THROWS: an email that
 * fails to send must not undo the access change, so the four write sites
 * (the admin member route and the holder team engine, grant and removal
 * each) call this AFTER their successful write and ignore the result beyond
 * logging. Nothing here writes membership.
 *
 * ── DEDUPE, TWO LAYERS, the second being the lifecycle discipline ─────────
 *
 * 1. CHANGE DETECTION: a repeated action changes nothing and sends nothing.
 *    The write sites pass what was true BEFORE their write (the prior role,
 *    or whether a row was actually removed); same role re-granted or a
 *    removal that matched no row is `skipped_no_change`.
 * 2. THE CLAIM: the same `subscription_email_log` claim -> send -> release
 *    cycle every lifecycle email uses (mig 181, reused via `dispatch`), so
 *    two racing writes cannot both send. The key is per person, project,
 *    role and day.
 *
 * ── UNDELIVERABLE ADDRESSES ARE SKIPPED, BEFORE ANY CLAIM ─────────────────
 *
 * The reserved `.invalid` TLD (RFC 2606) cannot receive mail by definition;
 * attempting the send would only burn a Brevo call and log a failure. Every
 * probe row this repo creates lives there, which is why the verifier can
 * exercise the write paths without the suite ever mailing anyone.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, FROM } from './sendEmail';
import { dispatch } from './subscriptionEmails';
import { accessGrantedEmail, accessRemovedEmail } from './templates/teamAccess';
import { getProjectSource } from '@/src/shared/admin/projectSources';
import { PROJECT_ROLE_META, type ProjectRole } from '@/src/core/collab/projectRoles';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export type NotifyOutcome =
  | 'sent' | 'deduped' | 'failed'
  | 'skipped_no_change' | 'skipped_undeliverable' | 'skipped_no_contact';

const dayStr = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const undeliverable = (email: string): boolean => /\.invalid$/i.test(email.trim());

async function contact(sb: SupabaseClient, userId: string): Promise<{ email: string; name: string | null } | null> {
  try {
    const { data } = await sb.from('users').select('email, name').eq('id', userId).maybeSingle();
    const r = data as { email?: string; name?: string | null } | null;
    return r?.email ? { email: r.email, name: r.name ?? null } : null;
  } catch { return null; }
}

async function projectName(sb: SupabaseClient, platformKey: string, projectId: string): Promise<string | null> {
  try {
    const source = getProjectSource(platformKey);
    if (!source) return null;
    const { data } = await sb.from(source.table).select(source.nameColumn).eq('id', projectId).maybeSingle();
    const r = data as unknown as Record<string, unknown> | null;
    return r ? ((r[source.nameColumn] as string) ?? null) : null;
  } catch { return null; }
}

export interface AccessGrantArgs {
  platformKey: string;
  projectId: string;
  targetUserId: string;
  actorUserId: string;
  role: string;
  /** What the membership row said BEFORE the write; null = no row. The
   *  change detection: previousRole === role sends nothing. */
  previousRole: string | null;
}

export async function notifyAccessGranted(sb: SupabaseClient, args: AccessGrantArgs): Promise<NotifyOutcome> {
  try {
    if (args.previousRole === args.role) return 'skipped_no_change';
    const target = await contact(sb, args.targetUserId);
    if (!target) return 'skipped_no_contact';
    if (undeliverable(target.email)) return 'skipped_undeliverable';
    const [actor, name] = await Promise.all([
      contact(sb, args.actorUserId),
      projectName(sb, args.platformKey, args.projectId),
    ]);
    const roleLabel = PROJECT_ROLE_META[args.role as ProjectRole]?.label ?? args.role;
    const sent = await dispatch(sb, {
      user_id: args.targetUserId,
      platform_slug: args.platformKey,
      email_type: 'team_access_granted',
      threshold: `${args.projectId}:${args.role}`,
      anchor_day: dayStr(Date.now()),
    }, async () => {
      const { subject, html } = await accessGrantedEmail({
        actorName: actor?.name ?? null,
        projectName: name ?? 'a project',
        roleLabel,
        openUrl: `${APP_URL}/dashboard`,
      });
      return (await sendEmail({ to: target.email, subject, html, from: FROM.noreply })).id;
    });
    return sent ? 'sent' : 'deduped';
  } catch (e) {
    console.warn('[team-email] grant notification failed harmlessly:', e instanceof Error ? e.message : String(e));
    return 'failed';
  }
}

export interface AccessRemovalArgs {
  platformKey: string;
  projectId: string;
  targetUserId: string;
  actorUserId: string;
  /** Whether the delete actually matched a row (count > 0). The change
   *  detection: removing access nobody had sends nothing. */
  removed: boolean;
}

export async function notifyAccessRemoved(sb: SupabaseClient, args: AccessRemovalArgs): Promise<NotifyOutcome> {
  try {
    if (!args.removed) return 'skipped_no_change';
    const target = await contact(sb, args.targetUserId);
    if (!target) return 'skipped_no_contact';
    if (undeliverable(target.email)) return 'skipped_undeliverable';
    const [actor, name] = await Promise.all([
      contact(sb, args.actorUserId),
      projectName(sb, args.platformKey, args.projectId),
    ]);
    const sent = await dispatch(sb, {
      user_id: args.targetUserId,
      platform_slug: args.platformKey,
      email_type: 'team_access_removed',
      threshold: args.projectId,
      anchor_day: dayStr(Date.now()),
    }, async () => {
      const { subject, html } = await accessRemovedEmail({
        actorName: actor?.name ?? null,
        projectName: name ?? 'a project',
      });
      return (await sendEmail({ to: target.email, subject, html, from: FROM.noreply })).id;
    });
    return sent ? 'sent' : 'deduped';
  } catch (e) {
    console.warn('[team-email] removal notification failed harmlessly:', e instanceof Error ? e.message : String(e));
    return 'failed';
  }
}
