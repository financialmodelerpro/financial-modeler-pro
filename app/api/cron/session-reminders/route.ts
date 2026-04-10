/**
 * GET /api/cron/session-reminders
 * Called by Vercel cron every 30 minutes.
 * Sends 24-hour and 1-hour reminder emails to registered students.
 * Secured by CRON_SECRET Authorization header.
 */

import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/lib/email/sendTemplatedEmail';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 min max

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const now = new Date();
  let reminders24h = 0;
  let reminders1h = 0;

  try {
    // ── 24-hour reminders ────────────────────────────────────────────────
    // Sessions between 23h and 25h from now
    const from24 = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    const to24   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

    const { data: sessions24 } = await sb
      .from('live_sessions')
      .select('*')
      .in('session_type', ['upcoming', 'live'])
      .eq('reminder_24h_sent', false)
      .eq('announcement_sent', true)  // only remind if already announced
      .gte('scheduled_datetime', from24)
      .lte('scheduled_datetime', to24);

    for (const session of sessions24 ?? []) {
      const { data: regs } = await sb
        .from('session_registrations')
        .select('student_email, student_name')
        .eq('session_id', session.id);

      if (regs && regs.length > 0) {
        const placeholders = buildSessionPlaceholders(session);
        await sendTemplatedEmail({
          templateKey: 'session_reminder_24h',
          recipients: regs.map(r => ({ email: r.student_email, name: r.student_name ?? '' })),
          placeholders,
        });
        reminders24h += regs.length;
      }

      await sb.from('live_sessions').update({ reminder_24h_sent: true }).eq('id', session.id);
    }

    // ── 1-hour reminders ─────────────────────────────────────────────────
    // Sessions between 45min and 75min from now
    const from1 = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
    const to1   = new Date(now.getTime() + 75 * 60 * 1000).toISOString();

    const { data: sessions1h } = await sb
      .from('live_sessions')
      .select('*')
      .in('session_type', ['upcoming', 'live'])
      .eq('reminder_1h_sent', false)
      .gte('scheduled_datetime', from1)
      .lte('scheduled_datetime', to1);

    for (const session of sessions1h ?? []) {
      const { data: regs } = await sb
        .from('session_registrations')
        .select('student_email, student_name')
        .eq('session_id', session.id);

      if (regs && regs.length > 0) {
        const placeholders = buildSessionPlaceholders(session);
        // Include join_url for 1-hour reminder
        if (session.live_url) placeholders.join_url = session.live_url;

        await sendTemplatedEmail({
          templateKey: 'session_reminder_1h',
          recipients: regs.map(r => ({ email: r.student_email, name: r.student_name ?? '' })),
          placeholders,
        });
        reminders1h += regs.length;
      }

      await sb.from('live_sessions').update({ reminder_1h_sent: true }).eq('id', session.id);
    }

    const processed = (sessions24?.length ?? 0) + (sessions1h?.length ?? 0);
    console.log(`[cron/session-reminders] processed=${processed} 24h=${reminders24h} 1h=${reminders1h}`);
    return Response.json({ processed, reminders_24h: reminders24h, reminders_1h: reminders1h });
  } catch (e) {
    console.error('[cron/session-reminders]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
