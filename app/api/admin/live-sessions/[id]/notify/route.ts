/**
 * Manual announcement / reminder dispatch for a live session.
 *
 * Replaces the removed auto-send on create/publish. Admin hits this via the
 * "Send Announcement" button in /admin/training-hub/live-sessions. Path
 * holds `maxDuration=300` so mass Resend batches don't get killed.
 *
 * GET  -> { recipient counts } so the confirm modal can show "N students"
 *         before the admin commits.
 * POST -> sends, writes `announcement_sent*` tracking columns, inserts a
 *         row in `announcement_send_log` for audit (migration 125).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { liveSessionNotificationTemplate } from '@/src/lib/email/templates/liveSessionNotification';

export const maxDuration = 300;
export const runtime     = 'nodejs';

type Target = 'all' | '3sfm' | 'bvm';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string; id?: string } | undefined;
  if (!user || user.role !== 'admin') return null;
  return user;
}

/** Returns confirmed training students matching the target filter. */
async function fetchRecipients(
  sb:     ReturnType<typeof getServerClient>,
  target: Target,
): Promise<{ email: string; name: string }[]> {
  let query = sb
    .from('training_registrations_meta')
    .select('email, name, course')
    .or('email_confirmed.eq.true,email_confirmed.is.null');

  const { data } = await query;
  let rows = (data ?? []) as { email: string | null; name: string | null; course: string | null }[];
  rows = rows.filter(r => !!r.email);

  if (target === '3sfm') rows = rows.filter(r => (r.course ?? '').toUpperCase().includes('3SFM'));
  if (target === 'bvm')  rows = rows.filter(r => (r.course ?? '').toUpperCase().includes('BVM'));

  // De-dupe by lowercased email (same person registered on multiple courses
  // shouldn't receive the same announcement twice).
  const seen = new Set<string>();
  const out: { email: string; name: string }[] = [];
  for (const r of rows) {
    const key = (r.email ?? '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: r.email!, name: r.name ?? '' });
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const url    = new URL(req.url);
  const target = ((url.searchParams.get('target') ?? 'all') as Target);

  const sb = getServerClient();
  const { data: session } = await sb
    .from('live_sessions')
    .select('id, title, announcement_sent, announcement_sent_at, announcement_sent_count, announcement_sent_by')
    .eq('id', id)
    .single();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const recipients = await fetchRecipients(sb, target);

  const { data: history } = await sb
    .from('announcement_send_log')
    .select('sent_at, sent_by_email, target, recipient_count, success_count, failure_count, was_preview, error_message')
    .eq('session_id', id)
    .order('sent_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    session: {
      id:                      session.id,
      title:                   session.title,
      announcement_sent:       session.announcement_sent ?? false,
      announcement_sent_at:    session.announcement_sent_at,
      announcement_sent_count: session.announcement_sent_count ?? 0,
      announcement_sent_by:    session.announcement_sent_by,
    },
    recipientCount: recipients.length,
    history:        history ?? [],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body   = await req.json() as { type?: 'announcement' | 'reminder'; target?: Target; preview?: boolean };
  const type    = body.type   ?? 'announcement';
  const target  = body.target ?? 'all';
  const preview = body.preview ?? false;

  const sb = getServerClient();

  const { data: liveSession } = await sb.from('live_sessions').select('*').eq('id', id).single();
  if (!liveSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const { data: atts } = await sb
    .from('course_attachments')
    .select('file_name, file_url')
    .eq('tab_key', `LIVE_${id}`)
    .eq('is_visible', true);

  let recipients: { email: string; name: string }[];
  if (preview) {
    if (!user.email) return NextResponse.json({ error: 'Admin email not available on session' }, { status: 400 });
    recipients = [{ email: user.email, name: 'Admin Preview' }];
  } else {
    recipients = await fetchRecipients(sb, target);
  }

  const { count: regCount } = await sb
    .from('session_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', id);

  const dt = liveSession.scheduled_datetime ? new Date(liveSession.scheduled_datetime) : null;
  const sessionDate = dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sessionTime = dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const sessionUrl = `${learnUrl}/training/live-sessions/${id}`;

  const dialIn = liveSession.teams_dial_in as { tollNumber?: string; conferenceId?: string } | null;

  let sent   = 0;
  let failed = 0;
  let lastError: string | null = null;
  const batchSize = 10;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async student => {
        const { subject, html } = await liveSessionNotificationTemplate({
          name:          student.name || student.email,
          sessionTitle:  liveSession.title,
          sessionDate,
          sessionTime,
          timezone:      liveSession.timezone ?? 'Asia/Riyadh',
          sessionUrl,
          joinUrl:       liveSession.live_url ?? undefined,
          description:   liveSession.description ?? undefined,
          attachments:   (atts ?? []).map(a => ({ name: a.file_name, url: a.file_url })),
          isReminder:    type === 'reminder',
          registrationCount: regCount ?? 0,
          dialInTollNumber:  dialIn?.tollNumber,
          dialInConferenceId: dialIn?.conferenceId,
        });
        return sendEmail({ to: student.email, subject, html, from: FROM.training });
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') sent++;
      else {
        failed++;
        if (!lastError) lastError = r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    }
  }

  // Audit row for every send attempt (preview included).
  await sb.from('announcement_send_log').insert({
    session_id:      id,
    sent_by_email:   user.email ?? null,
    sent_by_user_id: user.id ?? null,
    target,
    recipient_count: recipients.length,
    success_count:   sent,
    failure_count:   failed,
    was_preview:     preview,
    error_message:   lastError,
  });

  // Previews don't touch the session-level announcement status — they're
  // sent only to the admin's own inbox and wouldn't reflect a real dispatch.
  if (!preview && type === 'announcement' && sent > 0) {
    await sb.from('live_sessions').update({
      announcement_sent:       true,
      announcement_sent_at:    new Date().toISOString(),
      announcement_sent_count: sent,
      announcement_sent_by:    user.email ?? null,
    }).eq('id', id);
  }

  if (!preview && type === 'reminder' && sent > 0) {
    await sb.from('live_sessions').update({
      reminder_sent:       true,
      reminder_sent_at:    new Date().toISOString(),
      reminder_sent_count: sent,
    }).eq('id', id);
  }

  return NextResponse.json({
    success: true,
    sent,
    failed,
    total:   recipients.length,
    preview,
    target,
  });
}
