/**
 * GET /api/cron/model-submission-stale
 *
 * Daily digest reminder for the admin reviewer when one or more
 * model_submissions rows have been pending_review longer than the
 * configured stale threshold.
 *
 * Settings:
 *   - model_submission_stale_threshold_days  default 2
 *   - model_submission_admin_notify_enabled  default 'true'
 *   - model_submission_admin_notify_email    default ''
 *   - model_submission_review_sla_days       default 5 (display only)
 *
 * Reuses the same admin recipient + enable toggle as the per-submission
 * alert (F.1) so admins manage one address, not two. When the recipient
 * is empty OR the toggle is disabled OR no rows are stale, the cron
 * exits 200 with a no-op body. Vercel Hobby plan = once daily.
 *
 * Auth: CRON_SECRET bearer (same as session-reminders + newsletter).
 *
 * Idempotency: no per-row "reminder_sent" flag. If admin doesn't act
 * within 24 hours, the digest fires again. Surfacing the queue in the
 * inbox is the point; receiving the same digest twice is cheap.
 */

import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import {
  modelSubmissionStaleDigestTemplate,
  type StaleDigestRow,
} from '@/src/shared/email/templates/modelSubmissionStaleDigest';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PendingRow {
  id: string;
  email: string;
  course_code: '3SFM' | 'BVM';
  attempt_number: number;
  file_name: string;
  submitted_at: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();

  try {
    const { data: settingsRows } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', [
        'model_submission_admin_notify_enabled',
        'model_submission_admin_notify_email',
        'model_submission_stale_threshold_days',
        'model_submission_review_sla_days',
        'model_submission_max_attempts',
      ]);
    const settings: Record<string, string> = {};
    for (const r of (settingsRows ?? []) as { key: string; value: string }[]) settings[r.key] = r.value;

    const enabled = settings.model_submission_admin_notify_enabled !== 'false';
    const recipient = (settings.model_submission_admin_notify_email ?? '').trim();
    if (!enabled || !recipient) {
      console.log('[cron/model-submission-stale] skipped', { enabled, hasRecipient: !!recipient });
      return Response.json({ ok: true, skipped: true, reason: !enabled ? 'disabled' : 'no_recipient' });
    }

    const thresholdDays = Math.max(
      1,
      Math.min(30, parseInt(settings.model_submission_stale_threshold_days ?? '2', 10) || 2),
    );
    const reviewSlaDays = Math.max(
      1,
      Math.min(30, parseInt(settings.model_submission_review_sla_days ?? '5', 10) || 5),
    );
    const maxAttempts = Math.max(
      1,
      Math.min(10, parseInt(settings.model_submission_max_attempts ?? '3', 10) || 3),
    );

    const cutoffMs = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const { data: pendingRows, error: queryErr } = await sb
      .from('model_submissions')
      .select('id, email, course_code, attempt_number, file_name, submitted_at')
      .eq('status', 'pending_review')
      .lte('submitted_at', cutoffIso)
      .order('submitted_at', { ascending: true });

    if (queryErr) {
      console.error('[cron/model-submission-stale] query failed:', queryErr);
      return Response.json({ error: queryErr.message }, { status: 500 });
    }

    const pending = (pendingRows ?? []) as PendingRow[];
    if (pending.length === 0) {
      console.log('[cron/model-submission-stale] queue empty, no email sent');
      return Response.json({ ok: true, count: 0 });
    }

    // Best-effort student-name lookup. One IN-query against
    // training_registrations_meta covering every email at once.
    const emails = Array.from(new Set(pending.map(r => r.email.toLowerCase())));
    const { data: metaRows } = await sb
      .from('training_registrations_meta')
      .select('email, name, registration_id')
      .in('email', emails);
    const metaByEmail = new Map<string, { name: string | null; registration_id: string | null }>();
    for (const m of (metaRows ?? []) as { email: string; name: string | null; registration_id: string | null }[]) {
      metaByEmail.set(m.email.toLowerCase(), { name: m.name, registration_id: m.registration_id });
    }

    const now = Date.now();
    const digestRows: StaleDigestRow[] = pending.map(r => {
      const meta = metaByEmail.get(r.email.toLowerCase());
      const submittedAtMs = new Date(r.submitted_at).getTime();
      const daysWaiting = Math.max(1, Math.floor((now - submittedAtMs) / (24 * 60 * 60 * 1000)));
      return {
        submissionId: r.id,
        studentName: ((meta?.name ?? '').trim() || null),
        studentEmail: r.email,
        registrationId: meta?.registration_id ?? null,
        courseCode: r.course_code,
        fileName: r.file_name,
        attemptNumber: r.attempt_number,
        maxAttempts,
        submittedAt: r.submitted_at,
        daysWaiting,
      };
    });

    const { subject, html, text } = await modelSubmissionStaleDigestTemplate({
      rows: digestRows,
      thresholdDays,
      reviewSlaDays,
    });

    try {
      await sendEmail({ to: recipient, subject, html, text, from: FROM.training });
      console.log(`[cron/model-submission-stale] sent digest count=${pending.length} to=${recipient}`);
      return Response.json({ ok: true, count: pending.length, thresholdDays, sent: true });
    } catch (mailErr) {
      console.error('[cron/model-submission-stale] sendEmail failed:', mailErr);
      return Response.json({ error: 'send_failed', count: pending.length }, { status: 500 });
    }
  } catch (e) {
    console.error('[cron/model-submission-stale]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
