import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getStudentRoster } from '@/src/lib/training/studentRoster';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmailBatch, type BatchEmailItem } from '@/src/lib/email/sendEmail';
import { baseLayoutBranded } from '@/src/lib/email/templates/_base';

export const revalidate   = 0;
export const runtime      = 'nodejs';
export const maxDuration  = 300;

const RESEND_BATCH_LIMIT   = 100;
const INTER_BATCH_DELAY_MS = 200;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the admin's plain-text message body into the FMP branded shell.
 * Newlines become <br>, blank-line gaps become paragraph breaks. {name}
 * resolves to the recipient's first name (UI advertises this token).
 */
function renderMessageHtml(rawMessage: string, recipientName: string): string {
  const firstName = (recipientName || '').trim().split(/\s+/)[0] || recipientName || 'there';
  const personalised = rawMessage.replace(/\{name\}/g, firstName);
  const escaped = escapeHtml(personalised);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map(block => `<p style="margin:0 0 14px;line-height:1.6;color:#374151;">${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
  return paragraphs;
}

// ── GET: history or dropout groups ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get('type') ?? 'history';

  if (type === 'history') {
    const sb = getServerClient();
    const { data } = await sb.from('training_email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200);
    return NextResponse.json({ logs: data ?? [] });
  }

  if (type === 'dropout') {
    const students = await getStudentRoster();
    const now = Date.now();
    const DAY = 86400000;

    const neverStarted = students.filter(s =>
      (s.sessionsPassedCount ?? 0) === 0
    ).map(s => ({
      ...s,
      daysSinceEnroll: s.registeredAt ? Math.floor((now - new Date(s.registeredAt).getTime()) / DAY) : null,
    }));

    const stalled = students.filter(s => {
      const passed = s.sessionsPassedCount ?? 0;
      return passed > 0 && !s.finalPassed && !s.certificateIssued;
    }).map(s => ({
      ...s,
      daysSinceEnroll: s.registeredAt ? Math.floor((now - new Date(s.registeredAt).getTime()) / DAY) : null,
    }));

    const almostDone = students.filter(s => {
      const passed = s.sessionsPassedCount ?? 0;
      const total  = s.totalSessions ?? 17;
      return passed >= Math.floor(total * 0.8) && !s.finalPassed && !s.certificateIssued;
    }).map(s => ({
      ...s,
      sessionsLeft: (s.totalSessions ?? 17) - (s.sessionsPassedCount ?? 0),
    }));

    return NextResponse.json({ neverStarted, stalled, almostDone });
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
}

// ── POST: send announcement ───────────────────────────────────────────────────
//
// Sends via Resend `batch.send` chunked at 100 emails per request, wrapping
// every message in `baseLayoutBranded()` so the FMP logo header, signature
// HTML, footer text, and primary color from `email_branding` are applied
// uniformly. The previous version handed the payload off to Apps Script
// which sent raw text with no brand wrapper, no logo, no signature, and
// silently logged a fake 'sent' status when Apps Script was unreachable.
// `{name}` in the message body resolves to the recipient's first name (the
// UI advertises this token).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    campaignName: string;
    subject: string;
    message: string;
    emailType: string;
    recipients: { registrationId: string; email: string; name: string }[];
  };

  if (!body.recipients?.length) {
    return NextResponse.json({ error: 'No recipients' }, { status: 400 });
  }
  if (!body.subject?.trim() || !body.message?.trim()) {
    return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
  }

  const sb = getServerClient();

  // Filter to syntactically valid emails. Anything else is logged as
  // failed straight away rather than handed to Resend (which would 400).
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validRecipients   = body.recipients.filter(r => emailRe.test(r.email));
  const invalidRecipients = body.recipients.filter(r => !emailRe.test(r.email));

  // Build the per-recipient batch items. Each gets a personalised body so
  // `{name}` can resolve to the right student.
  const items: BatchEmailItem[] = await Promise.all(
    validRecipients.map(async (r) => {
      const inner = renderMessageHtml(body.message, r.name);
      const html  = await baseLayoutBranded(inner);
      return {
        to:      r.email,
        subject: body.subject,
        html,
      };
    })
  );
  const itemEmails = validRecipients.map(r => r.email);

  // Track per-recipient outcome so the DB log reflects reality. Seed all
  // valid items as 'sent', flip to 'failed' if their batch rejects.
  const outcome = new Map<string, 'sent' | 'failed'>();
  for (const r of validRecipients)   outcome.set(r.email, 'sent');
  for (const r of invalidRecipients) outcome.set(r.email, 'failed');

  let lastError: string | null = invalidRecipients.length > 0 ? 'Some addresses were invalid and skipped' : null;

  for (let i = 0; i < items.length; i += RESEND_BATCH_LIMIT) {
    const slice       = items.slice(i, i + RESEND_BATCH_LIMIT);
    const sliceEmails = itemEmails.slice(i, i + RESEND_BATCH_LIMIT);
    const result      = await sendEmailBatch(slice);
    if (!result.ok) {
      lastError = lastError ?? result.error ?? 'Resend batch failed';
      console.error('[communications POST] Resend batch failed', {
        error: result.error, batchSize: slice.length,
      });
      for (const email of sliceEmails) outcome.set(email, 'failed');
    }
    if (i + RESEND_BATCH_LIMIT < items.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  let sent   = 0;
  let failed = 0;
  for (const status of outcome.values()) {
    if (status === 'sent') sent++; else failed++;
  }

  const logRows = body.recipients.map(r => ({
    campaign_name:    body.campaignName,
    recipient_reg_id: r.registrationId,
    recipient_email:  r.email,
    email_type:       body.emailType,
    subject:          body.subject,
    status:           outcome.get(r.email) ?? 'failed',
  }));
  if (logRows.length > 0) {
    const { error: logErr } = await sb.from('training_email_log').insert(logRows);
    if (logErr) console.error('[communications POST] email_log insert failed:', logErr.message);
  }

  return NextResponse.json({ ok: true, sent, failed, error: lastError ?? undefined });
}
