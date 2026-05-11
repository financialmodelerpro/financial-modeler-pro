import { BrevoClient } from '@getbrevo/brevo';

let _brevo: BrevoClient | null = null;
function getBrevo(): BrevoClient {
  if (!_brevo) _brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY ?? '' });
  return _brevo;
}

export const FROM = {
  training: `Financial Modeler Pro Training <${process.env.EMAIL_FROM_TRAINING ?? 'training@financialmodelerpro.com'}>`,
  noreply:  `Financial Modeler Pro <${process.env.EMAIL_FROM_NOREPLY ?? 'no-reply@financialmodelerpro.com'}>`,
};

interface Sender { name: string; email: string }

// Brevo's `sender` is structured ({ name, email }); existing callers pass a
// single "Name <email>" string via the FROM constants. Parse to the
// structured shape so callers don't have to change.
function parseSender(s: string): Sender {
  const m = s.match(/^\s*(.+?)\s*<\s*(.+?)\s*>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: 'Financial Modeler Pro', email: s.trim() };
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

interface SendEmailResult {
  id: string;
}

export async function sendEmail({ to, subject, html, text, from }: SendEmailOptions): Promise<SendEmailResult> {
  const sender = parseSender(from ?? FROM.training);
  const recipients = (Array.isArray(to) ? to : [to]).map(email => ({ email }));
  const result = await getBrevo().transactionalEmails.sendTransacEmail({
    sender,
    to:          recipients,
    subject,
    htmlContent: html,
    textContent: text ?? stripHtml(html),
  });
  return { id: result.messageId ?? '' };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Batch send
//
// Resend's previous batch endpoint accepted up to 100 per-recipient
// personalized emails in one HTTP request and was all-or-nothing. Brevo
// has no equivalent: `sendTransacEmail` either targets one personalized
// message OR broadcasts the same message to many `to[]` entries. Since
// every BatchEmailItem here carries its own subject + html (e.g. the
// admin communications + live-session notify flows render per-recipient
// templates with name token substitution), we iterate per item via
// Promise.allSettled.
//
// We preserve the "binary" result semantics of the old wrapper: if every
// item succeeds we return ok=true with the messageIds in input order; if
// any item fails we return ok=false with empty ids + an error string.
// This matches how the existing callers branch on `result.ok` (notify +
// communications + newsletter all treat the whole slice as failed when
// the batch returns ok=false). A partial-success degraded view would
// require widening BatchEmailResult, which the task brief asked to keep
// unchanged for backwards compatibility.
//
// The per-recipient column is still named `resend_message_id` in the
// announcement_recipient_log table. The rename to a vendor-neutral name
// was skipped intentionally to avoid a migration touching the notify
// route, the admin UI, and the audit-log readers; we now store Brevo
// message ids in that column instead.
// ────────────────────────────────────────────────────────────────────────────

export interface BatchEmailItem {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
  from?:   string;
}

export interface BatchEmailResult {
  /** True when every item in the batch was accepted by Brevo. */
  ok: boolean;
  /**
   * Per-item Brevo message ids in the same order as the input. Only
   * populated when ok=true. Empty when ok=false.
   */
  ids: string[];
  /** Aggregate error description when ok=false. */
  error?: string;
}

export async function sendEmailBatch(items: BatchEmailItem[]): Promise<BatchEmailResult> {
  if (items.length === 0) return { ok: true, ids: [] };
  if (items.length > 100) {
    return { ok: false, ids: [], error: 'Batch exceeds limit of 100 emails per request' };
  }

  const brevo = getBrevo();
  // Per-item Promise.allSettled so a single rate-limit hit or validation
  // failure doesn't poison the whole batch's await; we collect statuses
  // and reduce to the binary ok/ids/error shape below.
  const settled = await Promise.allSettled(items.map(it => {
    const sender = parseSender(it.from ?? FROM.training);
    return brevo.transactionalEmails.sendTransacEmail({
      sender,
      to:          [{ email: it.to }],
      subject:     it.subject,
      htmlContent: it.html,
      textContent: it.text ?? stripHtml(it.html),
    });
  }));

  const ids: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      ids.push(r.value.messageId ?? '');
    } else {
      ids.push('');
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`item ${i}: ${msg}`);
    }
  }

  if (errors.length === 0) return { ok: true, ids };
  return {
    ok: false,
    ids: [],
    error: `${errors.length} of ${items.length} failed (first: ${errors[0]})`,
  };
}
