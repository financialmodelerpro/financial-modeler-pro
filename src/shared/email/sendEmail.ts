import { BrevoClient } from '@getbrevo/brevo';

let _brevo: BrevoClient | null = null;
function getBrevo(): BrevoClient {
  if (!_brevo) _brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY ?? '' });
  return _brevo;
}

export const FROM = {
  training: `Financial Modeler Pro Training <${process.env.EMAIL_FROM_TRAINING ?? 'training@financialmodelerpro.com'}>`,
  noreply:  `Financial Modeler Pro <${process.env.EMAIL_FROM_NOREPLY ?? 'no-reply@financialmodelerpro.com'}>`,
  support:  `Financial Modeler Pro <${process.env.EMAIL_FROM_SUPPORT ?? 'support@financialmodelerpro.com'}>`,
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

/** A single email attachment. Provide EITHER `content` (base64-encoded bytes) or
 *  `url` (a URL Brevo fetches at send time). Used for the invoice PDF on the
 *  Paddle welcome email; the PDF bytes are fetched server-side so the Paddle key
 *  never reaches the client. */
export interface EmailAttachment {
  name: string;
  content?: string; // base64
  url?: string;
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  id: string;
}

export async function sendEmail({ to, subject, html, text, from, attachments }: SendEmailOptions): Promise<SendEmailResult> {
  const sender = parseSender(from ?? FROM.training);
  const recipients = (Array.isArray(to) ? to : [to]).map(email => ({ email }));
  // Brevo's field is singular `attachment`; each entry carries name + (content | url).
  const attachment = attachments && attachments.length > 0
    ? attachments.map(a => (a.content != null ? { name: a.name, content: a.content } : { name: a.name, url: a.url ?? '' }))
    : undefined;
  const result = await getBrevo().transactionalEmails.sendTransacEmail({
    sender,
    to:          recipients,
    subject,
    htmlContent: html,
    textContent: text ?? stripHtml(html),
    ...(attachment ? { attachment } : {}),
  });
  return { id: result.messageId ?? '' };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
// Batch send
//
// The former email provider's batch endpoint accepted up to 100 per-recipient
// personalized emails in one HTTP request and was all-or-nothing. Brevo
// has no equivalent: `sendTransacEmail` either targets one personalized
// message OR broadcasts the same message to many `to[]` entries. Since
// every BatchEmailItem here carries its own subject + html (e.g. the
// admin communications + live-session notify flows render per-recipient
// templates with name token substitution), we iterate per item.
//
// Throttling: the first Brevo shim fired every item in the batch at once
// (one big Promise.allSettled). That reintroduced exactly the concurrent
// burst the earlier bounded-concurrency rewrite had removed: a 78-recipient announce became 78
// simultaneous API calls, which both risks Brevo's per-second rate limit
// and reads to mailbox providers (Gmail) like a spammy blast. We now send
// in WAVES of `BATCH_WAVE_SIZE` with a small `INTER_WAVE_DELAY_MS` pause
// between waves, restoring the bounded-concurrency + pacing behaviour.
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

// Bounded concurrency: emails sent simultaneously within one wave. Kept
// well under Brevo's transactional rate ceiling while staying fast enough
// that a full 100-item batch clears in a couple of seconds.
const BATCH_WAVE_SIZE = 10;
// Pause between waves. Mirrors the 200ms inter-batch delay the former
// implementation used to dodge rate-limit-induced silent drops.
const INTER_WAVE_DELAY_MS = 200;

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
  // ids stays index-aligned with `items` regardless of wave boundaries.
  const ids: string[] = new Array(items.length).fill('');
  const errors: string[] = [];

  // Send in bounded waves with a pause between them. Within a wave we use
  // Promise.allSettled so a single rate-limit hit or validation failure
  // doesn't poison the rest of the wave; we collect statuses and reduce to
  // the binary ok/ids/error shape below.
  for (let start = 0; start < items.length; start += BATCH_WAVE_SIZE) {
    const wave    = items.slice(start, start + BATCH_WAVE_SIZE);
    const settled = await Promise.allSettled(wave.map(it => {
      const sender = parseSender(it.from ?? FROM.training);
      return brevo.transactionalEmails.sendTransacEmail({
        sender,
        to:          [{ email: it.to }],
        subject:     it.subject,
        htmlContent: it.html,
        textContent: it.text ?? stripHtml(it.html),
      });
    }));

    for (let j = 0; j < settled.length; j++) {
      const idx = start + j;
      const r   = settled[j];
      if (r.status === 'fulfilled') {
        ids[idx] = r.value.messageId ?? '';
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(`item ${idx}: ${msg}`);
      }
    }

    if (start + BATCH_WAVE_SIZE < items.length) await sleep(INTER_WAVE_DELAY_MS);
  }

  if (errors.length === 0) return { ok: true, ids };
  return {
    ok: false,
    ids: [],
    error: `${errors.length} of ${items.length} failed (first: ${errors[0]})`,
  };
}
