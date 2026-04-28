/**
 * POST /api/webhooks/resend
 *
 * Receives Resend webhook events for newsletter campaigns:
 *   - email.sent / email.delivered  -> stamp recipient row
 *   - email.opened                   -> opened_at + status='opened'
 *   - email.clicked                  -> clicked_at + status='clicked'
 *   - email.bounced                  -> status='bounced' + auto-unsub on hard bounce
 *   - email.complained               -> status='complained' + auto-unsub
 *   - email.delivery_delayed         -> noop (transient)
 *
 * Resend signs webhooks with the Svix scheme. We verify the signature
 * manually using Node's crypto module so we don't pull in the svix
 * package. Secret format: `whsec_<base64-secret>` stored in
 * `RESEND_WEBHOOK_SECRET`. Verification flow:
 *   1. Read svix-id, svix-timestamp, svix-signature headers.
 *   2. Decode the secret (strip `whsec_` prefix, base64-decode).
 *   3. HMAC-SHA256 of `${id}.${timestamp}.${body}` with the secret.
 *   4. Base64-encode and compare against any `v1,<sig>` token in the
 *      space-separated svix-signature header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getServerClient } from '@/src/core/db/supabase';

export const runtime = 'nodejs';

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    subject?: string;
    bounce?: { type?: string; subType?: string };
    click?: { link?: string; ipAddress?: string; userAgent?: string };
    [k: string]: unknown;
  };
}

function verifySvixSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string,
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject timestamps older than 5 minutes (replay protection)
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > 5 * 60) return false;

  // whsec_<base64>
  const cleaned = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let secretBytes: Buffer;
  try { secretBytes = Buffer.from(cleaned, 'base64'); }
  catch { return false; }

  const signed = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes).update(signed).digest('base64');

  // svix-signature can contain multiple v1,<sig> entries separated by spaces.
  const candidates = svixSignature.split(' ').map(s => s.trim()).filter(Boolean);
  for (const c of candidates) {
    const [, sig] = c.split(',');
    if (!sig) continue;
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

async function handleEvent(event: ResendEvent): Promise<void> {
  const sb = getServerClient();
  const messageId = event.data?.email_id;
  if (!messageId) return;

  const now = new Date().toISOString();
  const type = event.type;

  // Map type -> partial recipient_log update
  // We always include the message id in the WHERE clause; the row is
  // unique per campaign per email, so the message id alone is enough
  // (email_id is globally unique).
  if (type === 'email.delivered' || type === 'email.sent') {
    // Already 'sent' from the send-time write; just stamp sent_at if null.
    await sb.from('newsletter_recipient_log')
      .update({ sent_at: now })
      .eq('resend_message_id', messageId)
      .is('sent_at', null);
    return;
  }

  if (type === 'email.opened') {
    await sb.from('newsletter_recipient_log')
      .update({ opened_at: now, status: 'opened' })
      .eq('resend_message_id', messageId)
      .is('opened_at', null);
    return;
  }

  if (type === 'email.clicked') {
    await sb.from('newsletter_recipient_log')
      .update({ clicked_at: now, status: 'clicked' })
      .eq('resend_message_id', messageId)
      .is('clicked_at', null);
    return;
  }

  if (type === 'email.bounced') {
    const bounceType = event.data?.bounce?.type ?? '';
    const isHard = /permanent|hard/i.test(bounceType) || bounceType === 'Permanent';
    await sb.from('newsletter_recipient_log')
      .update({ status: 'bounced', error_message: `bounce:${bounceType || 'unknown'}` })
      .eq('resend_message_id', messageId);

    if (isHard) {
      // Find the email behind this message id and flip every subscriber row
      const { data } = await sb.from('newsletter_recipient_log')
        .select('email').eq('resend_message_id', messageId).maybeSingle();
      if (data?.email) {
        await sb.from('newsletter_subscribers')
          .update({ status: 'bounced', unsubscribed_at: now })
          .eq('email', data.email);
      }
    }
    return;
  }

  if (type === 'email.complained') {
    await sb.from('newsletter_recipient_log')
      .update({ status: 'complained', error_message: 'complained' })
      .eq('resend_message_id', messageId);

    const { data } = await sb.from('newsletter_recipient_log')
      .select('email').eq('resend_message_id', messageId).maybeSingle();
    if (data?.email) {
      await sb.from('newsletter_subscribers')
        .update({ status: 'unsubscribed', unsubscribed_at: now })
        .eq('email', data.email);
    }
    return;
  }

  // delivery_delayed and unknown types: noop
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const ok = verifySvixSignature(
    rawBody,
    req.headers.get('svix-id'),
    req.headers.get('svix-timestamp'),
    req.headers.get('svix-signature'),
    secret,
  );
  if (!ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try { event = JSON.parse(rawBody) as ResendEvent; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error('[resend-webhook] handler failed', err);
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
