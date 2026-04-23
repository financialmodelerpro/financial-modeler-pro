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

// FMP brand accents reused across the admin announcement body. Kept narrow
// so the inline style strings stay readable below.
const FMP_TEAL    = '#2E75B6'; // inline link accent (matches baseLayout button)
const FMP_GOLD    = '#C9A84C'; // CTA button background (premium accent)
const FMP_NAVY    = '#1F3864'; // CTA button text + lead-in heading
const TEXT_DARK   = '#1F2937';
const TEXT_MUTED  = '#4B5563';

interface ResolvedTokens {
  firstName: string;
  fullName:  string;
  regId:     string;
  email:     string;
}

/**
 * Resolve the four tokens for one recipient. Pulls authoritative name +
 * registration_id from `training_registrations_meta` when present so a
 * Custom List entry that only knows the email still produces a clean
 * greeting like "Hi Ahmad (FMP-2026-0001)" instead of "Hi
 * ahmaddin.ch@gmail.com". Falls back to the email local part as the
 * first name when the recipient has no meta row at all.
 */
function resolveTokens(
  email:        string,
  metaName:     string | null | undefined,
  metaRegId:    string | null | undefined,
): ResolvedTokens {
  const cleanEmail = (email ?? '').trim();
  const fullName   = (metaName ?? '').trim();
  const fallback   = cleanEmail.split('@')[0] || 'there';
  const firstName  = fullName ? fullName.split(/\s+/)[0] : fallback;
  return {
    firstName,
    fullName: fullName || firstName,
    regId:    (metaRegId ?? '').trim(),
    email:    cleanEmail,
  };
}

function applyTokens(text: string, t: ResolvedTokens): string {
  const out = text
    .replace(/\{name\}/g,      t.firstName)
    .replace(/\{full_name\}/g, t.fullName)
    .replace(/\{reg_id\}/g,    t.regId)
    .replace(/\{email\}/g,     t.email);
  // Clean up "(  )" left behind when a recipient has no reg_id (custom list
  // entry not in meta). Trims trailing whitespace before the empty parens.
  return out.replace(/[ \t]+\(\s*\)/g, '');
}

/**
 * Render the admin's plain-text message body into HTML for the branded
 * shell. Behaviour:
 *  - Blank-line gaps become paragraphs.
 *  - Single newlines become <br />.
 *  - A line that is just a URL becomes a gold CTA button (Outlook-safe
 *    table layout). The line above (if it ends with ":") is rendered as
 *    a small lead-in heading instead of a paragraph.
 *  - Inline URLs inside paragraphs become teal underlined links.
 *  - Tokens resolved per recipient before rendering.
 */
function renderMessageHtml(rawMessage: string, t: ResolvedTokens): string {
  const text = applyTokens(rawMessage, t);
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];

  const URL_LINE = /^(https?:\/\/\S+)$/;

  for (const rawBlock of blocks) {
    const block = rawBlock.replace(/^\n+|\n+$/g, '');
    if (!block) continue;
    const lines = block.split('\n');
    const lastLine = lines[lines.length - 1].trim();

    if (URL_LINE.test(lastLine)) {
      const intro = lines.slice(0, -1).join('\n').trim();
      if (intro) {
        // Treat a trailing ":" as an explicit CTA lead-in and style it
        // slightly more prominently than a regular paragraph.
        const isLeadIn = intro.endsWith(':');
        const introHtml = isLeadIn
          ? `<p style="margin:0 0 8px;line-height:1.55;color:${FMP_NAVY};font-size:15px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${linkifyEscaped(escapeHtml(intro)).replace(/\n/g, '<br />')}</p>`
          : `<p style="margin:0 0 14px;line-height:1.65;color:${TEXT_DARK};font-size:15px;font-family:Arial,Helvetica,sans-serif;">${linkifyEscaped(escapeHtml(intro)).replace(/\n/g, '<br />')}</p>`;
        out.push(introHtml);
      }
      out.push(ctaButton(lastLine));
      continue;
    }

    const escaped = escapeHtml(block).replace(/\n/g, '<br />');
    out.push(`<p style="margin:0 0 18px;line-height:1.65;color:${TEXT_DARK};font-size:15px;font-family:Arial,Helvetica,sans-serif;">${linkifyEscaped(escaped)}</p>`);
  }

  return out.join('\n');
}

function linkifyEscaped(escapedHtml: string): string {
  // After escapeHtml, '&' has become '&amp;'. The URL regex tolerates that
  // (browsers parse '&amp;' inside an href back to '&'), and the visible
  // link text mirrors what the recipient sees in their address bar.
  return escapedHtml.replace(/(https?:\/\/[^\s<>"]+)/g, (url) => {
    return `<a href="${url}" style="color:${FMP_TEAL};text-decoration:underline;">${url}</a>`;
  });
}

function ctaLabel(href: string): string {
  if (/\/signin\b/i.test(href))   return 'Open my dashboard';
  if (/\/register\b/i.test(href)) return 'Get started';
  return 'Open link';
}

function ctaButton(href: string): string {
  const safe  = escapeHtml(href);
  const label = ctaLabel(href);
  // Bulletproof button: outer table for Outlook, inner anchor padded.
  // Gold background + navy text reads as premium without being loud.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;border-collapse:separate;">
  <tr>
    <td align="center" style="border-radius:8px;background:${FMP_GOLD};">
      <a href="${safe}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;color:${FMP_NAVY};text-decoration:none;font-weight:700;font-size:15px;font-family:Arial,Helvetica,sans-serif;border-radius:8px;letter-spacing:0.2px;">${label} &rarr;</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 18px;font-size:12px;color:${TEXT_MUTED};line-height:1.5;font-family:Arial,Helvetica,sans-serif;">Or paste this link into your browser: <span style="color:${FMP_TEAL};word-break:break-all;">${safe}</span></p>`;
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
    const STALLED_INACTIVITY_MS = 7 * DAY;
    const ALMOST_DONE_THRESHOLD = 0.65;

    // Common eligibility for every group: confirmed email + not yet
    // certified. A certified student is celebrated, not re-engaged.
    const eligible = students.filter(s => s.emailConfirmed && !s.certificateIssued);

    const withDays = (s: typeof eligible[number]) => ({
      ...s,
      daysSinceEnroll: s.registeredAt ? Math.floor((now - new Date(s.registeredAt).getTime()) / DAY) : null,
    });

    const neverStarted = eligible
      .filter(s => (s.sessionsPassedCount ?? 0) === 0)
      .map(withDays);

    // Stalled: started (>=1 passed assessment) AND last activity >= 7 days
    // ago. A student with no recorded activity at all but with passed
    // count > 0 is impossible (the passed row IS the activity), but we
    // still guard against missing completed_at on a legacy row.
    const stalled = eligible
      .filter(s => {
        const passed = s.sessionsPassedCount ?? 0;
        if (passed === 0) return false;
        if (!s.lastActivityAt) return false;
        const lastMs = new Date(s.lastActivityAt).getTime();
        return now - lastMs >= STALLED_INACTIVITY_MS;
      })
      .map(s => ({
        ...withDays(s),
        daysSinceLastActivity: s.lastActivityAt
          ? Math.floor((now - new Date(s.lastActivityAt).getTime()) / DAY)
          : null,
      }));

    // Almost Done: passed >= 65% of total course sessions across enrolled
    // courses. Course-session count comes from COURSES config (3SFM=18,
    // BVM=7). The previous proxy (distinct attempted tab_keys) understated
    // the denominator and surfaced students who had merely touched a few
    // sessions as "almost done."
    const almostDone = eligible
      .filter(s => {
        const passed = s.sessionsPassedCount ?? 0;
        const total  = s.totalCourseSessions ?? 0;
        if (total === 0) return false;
        return passed / total >= ALMOST_DONE_THRESHOLD;
      })
      .map(s => ({
        ...withDays(s),
        sessionsLeft: Math.max(0, (s.totalCourseSessions ?? 0) - (s.sessionsPassedCount ?? 0)),
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

  // Server-authoritative token resolution: pull name + registration_id
  // straight from training_registrations_meta in one query so a Custom
  // List entry that only knows the email still produces "Hi Ahmad
  // (FMP-2026-0001)" instead of "Hi ahmaddin.ch@gmail.com". Any
  // recipient whose email is not in meta falls back to the email local
  // part for {name} and an empty {reg_id} (the trailing "()" gets
  // stripped by applyTokens).
  const lowerEmails = Array.from(new Set(validRecipients.map(r => r.email.toLowerCase())));
  const { data: metaRows } = lowerEmails.length > 0
    ? await sb.from('training_registrations_meta')
        .select('email, name, registration_id')
        .in('email', lowerEmails)
    : { data: [] as { email: string; name: string | null; registration_id: string | null }[] };

  const metaByEmail = new Map<string, { name: string | null; registration_id: string | null }>();
  for (const m of (metaRows ?? [])) {
    metaByEmail.set((m.email ?? '').toLowerCase(), { name: m.name ?? null, registration_id: m.registration_id ?? null });
  }

  // Build per-recipient tokens once. The Custom List code path on the
  // client sets `name = email` and `registrationId = email`; we ignore
  // those obvious sentinels when falling back so an unknown recipient
  // does not land "Hi some@email.com (some@email.com)".
  const tokenize = (r: { email: string; name: string; registrationId: string }) => {
    const meta = metaByEmail.get(r.email.toLowerCase());
    const fallbackName  = (r.name  && r.name  !== r.email) ? r.name  : null;
    const fallbackRegId = (r.registrationId && !r.registrationId.includes('@')) ? r.registrationId : null;
    return resolveTokens(
      r.email,
      meta?.name             ?? fallbackName,
      meta?.registration_id  ?? fallbackRegId,
    );
  };

  // Build the per-recipient batch items. Each gets a personalised body
  // AND personalised subject (so "Hi {name}" lands clean even in the
  // inbox preview line).
  const items: BatchEmailItem[] = await Promise.all(
    validRecipients.map(async (r) => {
      const tokens = tokenize(r);
      const inner  = renderMessageHtml(body.message, tokens);
      const html   = await baseLayoutBranded(inner);
      return {
        to:      r.email,
        subject: applyTokens(body.subject, tokens),
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
