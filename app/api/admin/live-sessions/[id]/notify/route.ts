/**
 * Manual announcement / reminder dispatch for a live session.
 *
 * Replaces the removed auto-send on create/publish. Admin hits this via the
 * "Send Announcement" button in /admin/training-hub/live-sessions. Path
 * holds `maxDuration=300` so mass Resend batches don't get killed.
 *
 * Reliability rebuild (migration 138 era):
 *
 *   1. Sends use Resend's `batch.send([...])` instead of N parallel
 *      `emails.send` calls. The old 10-wide `Promise.allSettled` burst
 *      regularly tripped Resend's per-second rate limit (the "5 of 9
 *      delivered, 4 failed silently" symptom).
 *
 *   2. Per-recipient rows go into `announcement_recipient_log` *before*
 *      the batch fires (status='pending'), then get UPDATEd with the
 *      Resend message id or per-row error after the batch returns. The
 *      admin UI can now show *which* students got the email and which
 *      didn't, instead of just an aggregate "5 / 9".
 *
 *   3. New POST modes:
 *        - `recipientEmails: string[]`  Send only to this allowlist
 *          (used by the picker modal "Send to selected" + the "Send to
 *          myself" test button). Bypasses target / fetchRecipients.
 *        - `retrySendLogId: string`     Re-send only the failed/bounced
 *          rows from a prior dispatch. Reuses that send_log row, marks
 *          the recipient rows back to 'pending' before the retry. The
 *          students who already received the email do NOT get it again.
 *
 *   4. The `target` parameter (3sfm / bvm / all) now actually filters
 *      via training_enrollments (added in migration 132). The old
 *      "filter is decorative" comment is no longer true.
 *
 * GET  -> { recipients[], session, history } so the picker modal can
 *         render checkboxes per student before the admin commits.
 * POST -> sends, writes per-recipient log + aggregate counts, returns
 *         { sent, failed, sendLogId, results } for the UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmailBatch, FROM, type BatchEmailItem } from '@/src/lib/email/sendEmail';
import { liveSessionNotificationTemplate } from '@/src/lib/email/templates/liveSessionNotification';

export const maxDuration = 300;
export const runtime     = 'nodejs';

type Target = 'all' | '3sfm' | 'bvm';

interface RecipientRow {
  email:           string;
  name:            string;
  registration_id: string | null;
  courses:         string[];
}

const RESEND_BATCH_LIMIT = 100;
// Conservative stagger between batches when we have to make >1 call. Resend
// allows several requests per second at most paid tiers; this stays well
// below that without making the admin wait noticeably.
const INTER_BATCH_DELAY_MS = 200;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string; id?: string } | undefined;
  if (!user || user.role !== 'admin') return null;
  return user;
}

/**
 * Pull every confirmed (or legacy null-confirmed) student from
 * training_registrations_meta + their course enrollments. Honors the
 * target filter against `training_enrollments.course_code`.
 */
async function fetchRecipients(
  sb:     ReturnType<typeof getServerClient>,
  target: Target,
): Promise<RecipientRow[]> {
  const { data, error } = await sb
    .from('training_registrations_meta')
    .select('email, name, registration_id, training_enrollments(course_code)')
    .or('email_confirmed.eq.true,email_confirmed.is.null');

  if (error) {
    console.error('[notify/fetchRecipients] query failed', error.message);
    return [];
  }

  type Row = {
    email:           string | null;
    name:            string | null;
    registration_id: string | null;
    training_enrollments: { course_code: string }[] | null;
  };

  const seen = new Set<string>();
  const out:  RecipientRow[] = [];
  for (const r of (data ?? []) as Row[]) {
    const key = (r.email ?? '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const courses = (r.training_enrollments ?? []).map(e => (e.course_code ?? '').toUpperCase());
    if (target === '3sfm' && !courses.includes('3SFM')) continue;
    if (target === 'bvm'  && !courses.includes('BVM'))  continue;
    out.push({
      email:           r.email!.trim(),
      name:            (r.name ?? '').trim(),
      registration_id: r.registration_id,
      courses,
    });
  }
  return out;
}

/** Crude but Resend-safe check: rejects empty / no-@ / no-domain inputs. */
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
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
  const sendLogId = url.searchParams.get('sendLogId');

  const sb = getServerClient();
  const { data: session } = await sb
    .from('live_sessions')
    .select('id, title, announcement_sent, announcement_sent_at, announcement_sent_count, announcement_sent_by')
    .eq('id', id)
    .single();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Per-recipient drill-down for a specific dispatch. Used by the "View
  // recipients" panel + the Retry Failed flow.
  if (sendLogId) {
    const { data: rows } = await sb
      .from('announcement_recipient_log')
      .select('id, email, name, registration_id, status, resend_message_id, error_message, sent_at')
      .eq('send_log_id', sendLogId)
      .order('email', { ascending: true });
    return NextResponse.json({ recipients: rows ?? [] });
  }

  const recipients = await fetchRecipients(sb, target);

  const { data: history } = await sb
    .from('announcement_send_log')
    .select('id, sent_at, sent_by_email, target, recipient_count, success_count, failure_count, was_preview, error_message')
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
    recipients,
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
  const body   = await req.json() as {
    type?:            'announcement' | 'reminder';
    target?:          Target;
    preview?:         boolean;
    recipientEmails?: string[];
    retrySendLogId?:  string;
  };
  const type    = body.type    ?? 'announcement';
  const target  = body.target  ?? 'all';
  const preview = body.preview ?? false;

  const sb = getServerClient();

  const { data: liveSession } = await sb.from('live_sessions').select('*').eq('id', id).single();
  if (!liveSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const { data: atts } = await sb
    .from('course_attachments')
    .select('file_name, file_url')
    .eq('tab_key', `LIVE_${id}`)
    .eq('is_visible', true);

  // ── Resolve the recipient set + reuse-or-create the send_log row ────────
  let recipients: RecipientRow[];
  let sendLogId  = '';
  let isRetry  =  false;

  if (body.retrySendLogId) {
    // Retry mode: pull failed / bounced rows from the named dispatch and
    // re-attempt them in place. We do NOT create a new send_log row;
    // success/failure counts on the existing row are recomputed below.
    isRetry = true;
    sendLogId = body.retrySendLogId;
    const { data: failedRows, error: failedErr } = await sb
      .from('announcement_recipient_log')
      .select('email, name, registration_id')
      .eq('send_log_id', sendLogId)
      .in('status', ['failed', 'bounced']);
    if (failedErr) {
      return NextResponse.json({ error: failedErr.message }, { status: 500 });
    }
    recipients = (failedRows ?? []).map(r => ({
      email: r.email, name: r.name ?? '', registration_id: r.registration_id, courses: [],
    }));
  } else if (preview) {
    // Single-recipient admin preview (admin's own inbox).
    if (!user.email) return NextResponse.json({ error: 'Admin email not available on session' }, { status: 400 });
    recipients = [{ email: user.email, name: 'Admin Preview', registration_id: null, courses: [] }];
  } else if (Array.isArray(body.recipientEmails) && body.recipientEmails.length > 0) {
    // Explicit picker mode: limit fetchRecipients to the selected emails.
    // We re-fetch to get accurate name/regId/courses (and to silently drop
    // anyone the admin typed in who isn't actually a confirmed student).
    const wanted = new Set(body.recipientEmails.map(e => e.trim().toLowerCase()).filter(Boolean));
    const all = await fetchRecipients(sb, 'all');
    recipients = all.filter(r => wanted.has(r.email.toLowerCase()));
    // If the picker contained ad-hoc emails not in the roster (e.g. the
    // admin's own address for a test send), include them with empty meta.
    for (const e of wanted) {
      if (!recipients.some(r => r.email.toLowerCase() === e)) {
        if (looksLikeEmail(e)) recipients.push({ email: e, name: '', registration_id: null, courses: [] });
      }
    }
  } else {
    recipients = await fetchRecipients(sb, target);
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients to send to' }, { status: 400 });
  }

  // ── Pre-flight: fail any malformed addresses without sending them ──────
  // Resend would 400 on the entire batch otherwise.
  const validRecipients: RecipientRow[] = [];
  const invalidRecipients: RecipientRow[] = [];
  for (const r of recipients) {
    if (looksLikeEmail(r.email)) validRecipients.push(r);
    else invalidRecipients.push(r);
  }

  // ── Build the email content once per recipient (template inlines name) ──
  const { count: regCount } = await sb
    .from('session_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', id);

  const dt = liveSession.scheduled_datetime ? new Date(liveSession.scheduled_datetime) : null;
  const sessionDate = dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sessionTime = dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
  const learnUrl    = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const sessionUrl  = `${learnUrl}/training/live-sessions/${id}`;
  const dialIn      = liveSession.teams_dial_in as { tollNumber?: string; conferenceId?: string } | null;

  async function buildItem(r: RecipientRow): Promise<BatchEmailItem> {
    const { subject, html } = await liveSessionNotificationTemplate({
      name:               r.name || r.email,
      sessionTitle:       liveSession.title,
      sessionDate,
      sessionTime,
      timezone:           liveSession.timezone ?? 'Asia/Riyadh',
      sessionUrl,
      joinUrl:            liveSession.live_url ?? undefined,
      description:        liveSession.description ?? undefined,
      attachments:        (atts ?? []).map(a => ({ name: a.file_name, url: a.file_url })),
      isReminder:         type === 'reminder',
      registrationCount:  regCount ?? 0,
      dialInTollNumber:   dialIn?.tollNumber,
      dialInConferenceId: dialIn?.conferenceId,
    });
    return { to: r.email, subject, html, from: FROM.training };
  }

  // ── Create or reuse the parent audit row before any send fires ─────────
  if (!isRetry) {
    const { data: row, error: insertErr } = await sb
      .from('announcement_send_log')
      .insert({
        session_id:      id,
        sent_by_email:   user.email   ?? null,
        sent_by_user_id: user.id      ?? null,
        target,
        recipient_count: recipients.length,
        success_count:   0,
        failure_count:   0,
        was_preview:     preview,
        error_message:   null,
      })
      .select('id')
      .single();
    if (insertErr || !row) {
      return NextResponse.json({ error: insertErr?.message ?? 'Failed to create audit log' }, { status: 500 });
    }
    sendLogId = row.id;

    // Per-recipient rows seeded as 'pending'. Invalid addresses are stamped
    // straight to 'failed' so the picker shows the truth instead of a
    // perpetually-pending row.
    const initialRows = [
      ...validRecipients.map(r => ({
        send_log_id:     sendLogId,
        email:           r.email,
        name:            r.name || null,
        registration_id: r.registration_id,
        status:          'pending' as const,
      })),
      ...invalidRecipients.map(r => ({
        send_log_id:     sendLogId,
        email:           r.email,
        name:            r.name || null,
        registration_id: r.registration_id,
        status:          'failed' as const,
        error_message:   'Invalid email address (rejected client-side before send)',
      })),
    ];
    if (initialRows.length > 0) {
      const { error: rowErr } = await sb.from('announcement_recipient_log').insert(initialRows);
      if (rowErr) console.error('[notify POST] recipient_log seed failed:', rowErr.message);
    }
  } else {
    // Retry: flip the failed rows back to 'pending' for the duration of
    // this attempt; they'll be UPDATEd to sent/failed below.
    await sb
      .from('announcement_recipient_log')
      .update({ status: 'pending', error_message: null })
      .eq('send_log_id', sendLogId)
      .in('status', ['failed', 'bounced']);
  }

  // ── Build all email items (parallel render is safe, no IO yet) ─────────
  const items     = await Promise.all(validRecipients.map(buildItem));
  const itemEmails = validRecipients.map(r => r.email);

  // ── Send in batches of 100 with a small stagger between batches ────────
  let sent       = 0;
  let failed     = invalidRecipients.length;
  let lastError: string | null = invalidRecipients.length > 0 ? 'Some addresses were invalid and skipped' : null;

  for (let i = 0; i < items.length; i += RESEND_BATCH_LIMIT) {
    const slice       = items.slice(i, i + RESEND_BATCH_LIMIT);
    const sliceEmails = itemEmails.slice(i, i + RESEND_BATCH_LIMIT);
    const result      = await sendEmailBatch(slice);

    if (result.ok) {
      sent += slice.length;
      // Stamp success per-recipient. Resend returns ids in input order.
      const updates = slice.map((_, idx) => ({
        email:             sliceEmails[idx],
        resend_message_id: result.ids[idx] ?? null,
      }));
      // Supabase has no efficient "bulk update by composite key" path; loop
      // through each recipient's UPDATE. With batch sizes <=100 this is
      // a fast stream of single-row updates against an indexed column.
      for (const u of updates) {
        await sb
          .from('announcement_recipient_log')
          .update({
            status:            'sent',
            resend_message_id: u.resend_message_id,
            sent_at:           new Date().toISOString(),
            error_message:     null,
          })
          .eq('send_log_id', sendLogId)
          .eq('email',       u.email);
      }
    } else {
      failed += slice.length;
      if (!lastError) lastError = result.error ?? 'Resend batch failed';
      console.error('[notify POST] Resend batch failed', { error: result.error, batchSize: slice.length });
      for (const email of sliceEmails) {
        await sb
          .from('announcement_recipient_log')
          .update({
            status:        'failed',
            error_message: result.error ?? 'Resend batch failed',
          })
          .eq('send_log_id', sendLogId)
          .eq('email',       email);
      }
    }

    if (i + RESEND_BATCH_LIMIT < items.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  // ── Refresh aggregate counts on the parent send_log row ────────────────
  // Recompute from the recipient rows so retries reflect reality.
  const { count: sentCount }   = await sb
    .from('announcement_recipient_log')
    .select('*', { count: 'exact', head: true })
    .eq('send_log_id', sendLogId)
    .eq('status', 'sent');
  const { count: failedCount } = await sb
    .from('announcement_recipient_log')
    .select('*', { count: 'exact', head: true })
    .eq('send_log_id', sendLogId)
    .in('status', ['failed', 'bounced']);

  await sb
    .from('announcement_send_log')
    .update({
      success_count: sentCount  ?? 0,
      failure_count: failedCount ?? 0,
      error_message: lastError,
    })
    .eq('id', sendLogId);

  // ── Session-level "announcement_sent" markers ──────────────────────────
  // Previews don't touch them. Retries don't bump them. Only fresh
  // announcement dispatches that delivered at least one email do.
  if (!preview && !isRetry && type === 'announcement' && sent > 0) {
    await sb.from('live_sessions').update({
      announcement_sent:       true,
      announcement_sent_at:    new Date().toISOString(),
      announcement_sent_count: sent,
      announcement_sent_by:    user.email ?? null,
    }).eq('id', id);
  }

  if (!preview && !isRetry && type === 'reminder' && sent > 0) {
    await sb.from('live_sessions').update({
      reminder_sent:       true,
      reminder_sent_at:    new Date().toISOString(),
      reminder_sent_count: sent,
    }).eq('id', id);
  }

  return NextResponse.json({
    success:    true,
    sent,
    failed,
    total:      recipients.length,
    preview,
    isRetry,
    sendLogId,
    target,
    error:      lastError,
  });
}
