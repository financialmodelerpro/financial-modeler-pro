/**
 * Central newsletter sender. One implementation, three callers:
 *   - /api/admin/newsletter/send (manual)
 *   - /api/cron/newsletter-scheduled (scheduled)
 *   - autoNotify.sendAutoNewsletter (event-driven)
 *
 * Pipeline:
 *   1. Resolve segment to recipients (deduped).
 *   2. Insert one `pending` row per recipient into newsletter_recipient_log.
 *   3. Chunk recipients into batches of 100.
 *   4. For each batch:
 *      a. Render body with link wrapping (msgIdPlaceholder still {msg}).
 *      b. Build BatchEmailItem[] - each item gets the body with the same
 *         placeholder; we cannot inject a per-recipient msg_id until we
 *         have the response ids back. So we keep the placeholder, and
 *         the click endpoint also accepts ?campaign=X to fall back when
 *         msg= is missing.
 *      c. Fire resend.batch.send([100]).
 *      d. Update recipient_log with the returned message_ids and status=sent
 *         (or status=failed with error_message on batch error).
 *   5. Update campaign aggregate counts.
 *   6. 200ms stagger between batches.
 *
 * Returns aggregate stats. Throws nothing in the happy path; any failure
 * is logged to the recipient row instead so partial sends are recoverable.
 */
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmailBatch, FROM, type BatchEmailItem } from '@/src/lib/email/sendEmail';
import { newsletterTemplate } from '@/src/lib/email/templates/newsletter';
import { resolveSegment, type SegmentKey, type ResolvedRecipient } from './segments';
import { wrapLinks } from './linkWrap';

const BATCH_SIZE = 100;
const STAGGER_MS = 200;

export interface SendCampaignArgs {
  campaignId: string;
  subject: string;
  body: string;
  targetHub: 'training' | 'modeling' | 'all';
  segment: SegmentKey;
  /**
   * Optional explicit recipient list. When supplied, segment+targetHub
   * are ignored. Used by the retry-failed flow to send only to a
   * subset (the prior failures).
   */
  recipients?: ResolvedRecipient[];
}

export interface SendCampaignResult {
  attempted: number;
  sent: number;
  failed: number;
}

async function seedPendingRecipients(campaignId: string, recipients: ResolvedRecipient[]): Promise<void> {
  if (recipients.length === 0) return;
  const sb = getServerClient();
  const rows = recipients.map(r => ({ campaign_id: campaignId, email: r.email, status: 'pending' as const }));
  // Upsert so retry runs do not collide with prior pending rows for the same email
  await sb.from('newsletter_recipient_log').upsert(rows, { onConflict: 'campaign_id,email' });
}

async function markBatchSent(
  campaignId: string,
  batch: ResolvedRecipient[],
  messageIds: string[],
): Promise<void> {
  const sb = getServerClient();
  const now = new Date().toISOString();
  // Update each row individually so we can write the matching message_id.
  // We only have BATCH_SIZE rows max; the cost is acceptable.
  await Promise.all(batch.map((r, i) => sb
    .from('newsletter_recipient_log')
    .update({
      status: 'sent',
      resend_message_id: messageIds[i] ?? null,
      sent_at: now,
      error_message: null,
    })
    .eq('campaign_id', campaignId)
    .eq('email', r.email)));
}

async function markBatchFailed(
  campaignId: string,
  batch: ResolvedRecipient[],
  errorMessage: string,
): Promise<void> {
  const sb = getServerClient();
  await Promise.all(batch.map(r => sb
    .from('newsletter_recipient_log')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('campaign_id', campaignId)
    .eq('email', r.email)));
}

export async function sendCampaign(args: SendCampaignArgs): Promise<SendCampaignResult> {
  const sb = getServerClient();

  const recipients = args.recipients ?? await resolveSegment(args.segment, args.targetHub);

  await sb.from('newsletter_campaigns').update({ status: 'sending' }).eq('id', args.campaignId);

  if (recipients.length === 0) {
    await sb.from('newsletter_campaigns').update({
      status: 'sent',
      sent_count: 0,
      failed_count: 0,
      sent_at: new Date().toISOString(),
    }).eq('id', args.campaignId);
    return { attempted: 0, sent: 0, failed: 0 };
  }

  await seedPendingRecipients(args.campaignId, recipients);

  // Wrap links once per campaign (not per recipient). The {msg} placeholder
  // stays in the URL until/unless we want per-recipient injection - for now
  // the click endpoint resolves identity via campaign + (optional) msg id
  // returned from the Resend webhook later.
  const wrappedBody = wrapLinks(args.body, { campaignId: args.campaignId });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    // Build batch items. Per-recipient template wraps the body with the
    // hub-specific unsubscribe link, so we render each item separately
    // even though they all share the same wrappedBody source.
    const items: BatchEmailItem[] = await Promise.all(batch.map(async r => {
      const { html, text } = await newsletterTemplate({
        body: wrappedBody,
        hub: r.hub,
        unsubscribeToken: r.unsubscribe_token,
      });
      return {
        from:    FROM.noreply,
        to:      r.email,
        subject: args.subject,
        html,
        text,
      };
    }));

    const result = await sendEmailBatch(items);
    if (result.ok) {
      await markBatchSent(args.campaignId, batch, result.ids);
      sent += batch.length;
    } else {
      await markBatchFailed(args.campaignId, batch, result.error ?? 'batch error');
      failed += batch.length;
    }

    if (i + BATCH_SIZE < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, STAGGER_MS));
    }
  }

  await sb.from('newsletter_campaigns').update({
    status: failed === recipients.length ? 'failed' : 'sent',
    sent_count: sent,
    failed_count: failed,
    sent_at: new Date().toISOString(),
  }).eq('id', args.campaignId);

  return { attempted: recipients.length, sent, failed };
}

/** Simple one-off send used by the test-send button. No log, no batch. */
export async function sendTestEmail(args: {
  toEmail: string;
  subject: string;
  body: string;
  hub: 'training' | 'modeling' | 'all';
  unsubscribeToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { html, text } = await newsletterTemplate({
      body: args.body,
      hub: args.hub === 'all' ? 'training' : args.hub,
      unsubscribeToken: args.unsubscribeToken,
    });
    const result = await sendEmailBatch([{
      from:    FROM.noreply,
      to:      args.toEmail,
      subject: `[TEST] ${args.subject}`,
      html,
      text,
    }]);
    if (!result.ok) return { ok: false, error: result.error ?? 'send failed' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
