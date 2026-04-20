/**
 * Session announcement broadcast.
 *
 * Single flow used by two admin entry points:
 *   - POST /api/admin/live-sessions           (creating a session with is_published=true)
 *   - PATCH /api/admin/live-sessions/[id]    (flipping is_published false → true)
 *
 * Fires when:
 *   - session.is_published === true
 *   - session.session_type is 'upcoming' or 'live'
 *   - session.announcement_sent is false (idempotent — never double-sends)
 *   - session.announcement_send_mode !== 'manual' (admin opted for auto)
 *
 * Sends `session_announcement` via `sendTemplatedEmail` to every confirmed
 * student in `training_registrations_meta`, then flips
 * `live_sessions.announcement_sent = true`. The per-session flag also gates
 * the reminder cron — "no announcement, no reminder."
 *
 * Fire-and-forget at call sites: wrap in `void` so a Resend hiccup doesn't
 * fail the admin's create/publish request. Errors are logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/lib/email/sendTemplatedEmail';

type LiveSessionRow = {
  id:                       string;
  is_published?:            boolean | null;
  session_type?:            string | null;
  announcement_sent?:       boolean | null;
  announcement_send_mode?:  string | null;
  [key: string]:            unknown;
};

interface Result {
  sent?:    number;
  failed?:  number;
  skipped?: string;
}

async function getAllConfirmedStudents(sb: SupabaseClient): Promise<{ email: string; name: string }[]> {
  // null email_confirmed = pre-migration-027 students; treat as confirmed
  // (same rule the validate + resend-confirmation routes apply).
  const { data } = await sb
    .from('training_registrations_meta')
    .select('email, name')
    .or('email_confirmed.eq.true,email_confirmed.is.null');
  return (data ?? []).map((r: { email: string; name: string | null }) => ({
    email: r.email,
    name:  r.name ?? '',
  }));
}

export async function sendSessionAnnouncement(
  sb:      SupabaseClient,
  session: LiveSessionRow,
): Promise<Result> {
  if (!session?.id)                                                      return { skipped: 'no_session_id' };
  if (session.is_published !== true)                                     return { skipped: 'not_published' };
  if (session.announcement_sent === true)                                return { skipped: 'already_sent' };
  if (session.announcement_send_mode === 'manual')                       return { skipped: 'manual_mode' };
  if (session.session_type !== 'upcoming' && session.session_type !== 'live') {
    return { skipped: `session_type=${session.session_type ?? 'unknown'}` };
  }

  try {
    const students = await getAllConfirmedStudents(sb);
    if (students.length === 0) {
      // Still flip the flag so the cron doesn't look at an un-announced
      // session forever; no students means no reminders either.
      await sb.from('live_sessions').update({ announcement_sent: true }).eq('id', session.id);
      return { sent: 0, failed: 0, skipped: 'no_recipients' };
    }

    const placeholders = buildSessionPlaceholders(session);
    const result = await sendTemplatedEmail({
      templateKey:  'session_announcement',
      recipients:   students,
      placeholders,
    });

    // Flip the flag even if some recipients failed — a subsequent admin
    // click of the "Notify" button can target individual addresses if
    // needed, but we don't want to re-blast everyone on retry.
    await sb.from('live_sessions').update({ announcement_sent: true }).eq('id', session.id);

    return { sent: result.sent, failed: result.failed };
  } catch (e) {
    console.error('[sendSessionAnnouncement]', { sessionId: session.id, error: String(e) });
    return { sent: 0, failed: 0, skipped: 'exception' };
  }
}
