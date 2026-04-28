import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export const FROM = {
  training: `Financial Modeler Pro Training <${process.env.EMAIL_FROM_TRAINING ?? 'training@financialmodelerpro.com'}>`,
  noreply:  `Financial Modeler Pro <${process.env.EMAIL_FROM_NOREPLY ?? 'no-reply@financialmodelerpro.com'}>`,
};

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, text, from }: SendEmailOptions) {
  const { data, error } = await getResend().emails.send({
    from:    from ?? FROM.training,
    to:      Array.isArray(to) ? to : [to],
    subject,
    html,
    text:    text ?? stripHtml(html),
  });
  if (error) throw new Error(error.message);
  return data;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Batch send (Resend /emails/batch)
//
// Up to 100 emails per HTTP request, one rate-limit slot per request. This
// is what the live-session announcement flow uses now: previously we fired
// 10 parallel `emails.send` calls per "batch", which burst past Resend's
// per-second limit and produced the partial-success symptom (5 of 9
// delivered, 4 failed with 429). One batch.send([...]) avoids that.
//
// Resend's batch response is all-or-nothing per request: if the SDK
// rejects, no items in the batch were enqueued. The synchronous response
// confirms acceptance for delivery, not actual delivery; bounces and
// complaints arrive later via webhooks.
// ────────────────────────────────────────────────────────────────────────────

export interface BatchEmailItem {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
  from?:   string;
}

export interface BatchEmailResult {
  /** True when the SDK accepted the entire batch. */
  ok: boolean;
  /**
   * Per-item Resend message ids in the same order as the input. Only
   * populated when ok=true. Empty when ok=false.
   */
  ids: string[];
  /** Top-level error from Resend (rate limit, validation, auth). */
  error?: string;
}

export async function sendEmailBatch(items: BatchEmailItem[]): Promise<BatchEmailResult> {
  if (items.length === 0) return { ok: true, ids: [] };
  if (items.length > 100) {
    return { ok: false, ids: [], error: 'Batch exceeds Resend limit of 100 emails per request' };
  }

  const payload = items.map(it => ({
    from:    it.from ?? FROM.training,
    to:      [it.to],
    subject: it.subject,
    html:    it.html,
    text:    it.text ?? stripHtml(it.html),
  }));

  try {
    const { data, error } = await getResend().batch.send(payload);
    if (error) return { ok: false, ids: [], error: error.message };
    const ids = (data?.data ?? []).map((d: { id?: string }) => d.id ?? '');
    return { ok: true, ids };
  } catch (e) {
    return { ok: false, ids: [], error: e instanceof Error ? e.message : String(e) };
  }
}
