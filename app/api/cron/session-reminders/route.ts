/**
 * GET /api/cron/session-reminders
 *
 * Fires 24-hour and 1-hour reminders to students registered for an
 * upcoming live session. Uses PER-REGISTRATION flags
 * (`session_registrations.reminder_24h_sent` / `reminder_1h_sent`,
 * added in migration 122) so a student who registers late still gets
 * reminders in whichever windows are still ahead of them.
 *
 * Session-level gate: `live_sessions.announcement_sent` must be true.
 * That ensures we only remind for sessions the platform has already
 * announced — no leaking unpublished sessions through reminder mail.
 *
 * Secured by CRON_SECRET Authorization header (same pattern as
 * /api/cron/certificates + /api/cron/auto-launch-check).
 *
 * Vercel Hobby schedule is once per day (see vercel.json). Windows are
 * intentionally wide so a single daily run doesn't miss sessions: any
 * session whose scheduled_datetime falls in the future bucket that
 * this run covers will dispatch reminders to all pending registrations.
 */

import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/shared/email/sendTemplatedEmail';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface SessionRow {
  id: string;
  title?: string | null;
  scheduled_datetime?: string | null;
  live_url?: string | null;
  [key: string]: unknown;
}

interface RegistrationRow {
  id:               string;
  session_id:       string;
  student_email:    string;
  student_name:     string | null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const now = new Date();

  // ── 24-hour reminder window ─────────────────────────────────────────
  // Session starts 23–26 hours from now. Slight right-tail overshoot
  // absorbs cron clock drift between daily runs.
  const from24 = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to24   = new Date(now.getTime() + 26 * 60 * 60 * 1000).toISOString();

  // ── 1-hour reminder window ──────────────────────────────────────────
  // Session starts 45–75 minutes from now.
  const from1 = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
  const to1   = new Date(now.getTime() + 75 * 60 * 1000).toISOString();

  let sent24h = 0;
  let sent1h  = 0;
  let failed  = 0;

  try {
    // Fetch announced sessions in both windows in parallel, then process
    // per-session so we can mark only the recipients who actually got
    // the reminder (per-reg flag).
    const [{ data: sessions24 }, { data: sessions1h }] = await Promise.all([
      sb.from('live_sessions')
        .select('id, title, description, scheduled_datetime, timezone, live_url, banner_url, duration_minutes, session_type')
        .in('session_type', ['upcoming', 'live'])
        .eq('announcement_sent', true)
        .gte('scheduled_datetime', from24)
        .lte('scheduled_datetime', to24),
      sb.from('live_sessions')
        .select('id, title, description, scheduled_datetime, timezone, live_url, banner_url, duration_minutes, session_type')
        .in('session_type', ['upcoming', 'live'])
        .eq('announcement_sent', true)
        .gte('scheduled_datetime', from1)
        .lte('scheduled_datetime', to1),
    ]);

    for (const session of (sessions24 ?? []) as SessionRow[]) {
      const { sent, fail } = await dispatchReminder(sb, session, 'reminder_24h_sent', 'session_reminder_24h', false);
      sent24h += sent;
      failed  += fail;
    }

    for (const session of (sessions1h ?? []) as SessionRow[]) {
      const { sent, fail } = await dispatchReminder(sb, session, 'reminder_1h_sent', 'session_reminder_1h', true);
      sent1h += sent;
      failed += fail;
    }

    const processed = (sessions24?.length ?? 0) + (sessions1h?.length ?? 0);
    console.log(`[cron/session-reminders] processed=${processed} 24h=${sent24h} 1h=${sent1h} failed=${failed}`);
    return Response.json({ processed, reminders_24h: sent24h, reminders_1h: sent1h, failed });
  } catch (e) {
    console.error('[cron/session-reminders]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Pulls every registration for the session whose `flagCol` is still
 * false, sends the reminder template, flips the flag per-row. Batched
 * via sendTemplatedEmail's internal Promise.allSettled so one bad
 * address doesn't stall the rest.
 */
async function dispatchReminder(
  sb:               ReturnType<typeof getServerClient>,
  session:          SessionRow,
  flagCol:          'reminder_24h_sent' | 'reminder_1h_sent',
  templateKey:      string,
  includeJoinUrl:   boolean,
): Promise<{ sent: number; fail: number }> {
  const { data: regs } = await sb
    .from('session_registrations')
    .select('id, session_id, student_email, student_name')
    .eq('session_id', session.id)
    .eq(flagCol, false);

  const pending = (regs ?? []) as RegistrationRow[];
  if (pending.length === 0) return { sent: 0, fail: 0 };

  const placeholders = buildSessionPlaceholders(session);
  if (includeJoinUrl && session.live_url) placeholders.join_url = session.live_url;

  const result = await sendTemplatedEmail({
    templateKey,
    recipients:   pending.map(r => ({ email: r.student_email, name: r.student_name ?? '' })),
    placeholders,
  });

  // Flip the flag on every targeted row — even those Resend dropped.
  // Retrying a whole batch on partial failure would re-email the
  // recipients who succeeded. Admins can re-invite individual
  // students via the manual Notify route if needed.
  const targetIds = pending.map(r => r.id);
  await sb
    .from('session_registrations')
    .update({ [flagCol]: true })
    .in('id', targetIds);

  return { sent: result.sent ?? 0, fail: result.failed ?? 0 };
}
