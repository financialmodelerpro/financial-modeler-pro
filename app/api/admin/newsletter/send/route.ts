import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { Resend } from 'resend';
import { newsletterTemplate } from '@/src/lib/email/templates/newsletter';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM_NOREPLY ?? 'noreply@financialmodelerpro.com';

interface Sub { email: string; hub: string; unsubscribe_token: string }

/** Deduplicate subscribers by email — one email per person, prefer matching hub token. */
function deduplicateByEmail(subscribers: Sub[], preferHub?: string): Sub[] {
  const map = new Map<string, Sub>();
  for (const sub of subscribers) {
    const existing = map.get(sub.email);
    if (!existing) { map.set(sub.email, sub); continue; }
    // Prefer the row matching the target hub for the unsubscribe token
    if (preferHub && sub.hub === preferHub && existing.hub !== preferHub) {
      map.set(sub.email, sub);
    }
  }
  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = (session?.user as { email?: string; role?: string } | undefined);
  if (adminEmail?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { subject, body, targetHub } = await req.json() as { subject: string; body: string; targetHub: string };
    if (!subject?.trim() || !body?.trim() || !['training', 'modeling', 'all'].includes(targetHub)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sb = getServerClient();

    const { data: campaign, error: campErr } = await sb.from('newsletter_campaigns').insert({
      subject: subject.trim(),
      body,
      target_hub: targetHub,
      status: 'sending',
      created_by: adminEmail?.email ?? 'admin',
    }).select('id').single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
    }

    const campaignId = campaign.id;

    // Fire-and-forget sending
    (async () => {
      let sentCount = 0;
      let failedCount = 0;
      try {
        let query = sb.from('newsletter_subscribers').select('email, hub, unsubscribe_token').eq('status', 'active');
        if (targetHub !== 'all') query = query.eq('hub', targetHub);
        const { data: rawSubs } = await query;

        // Deduplicate when sending to "all" — one email per person
        const subscribers = targetHub === 'all'
          ? deduplicateByEmail(rawSubs ?? [])
          : (rawSubs ?? []);

        for (const sub of subscribers) {
          try {
            const hubLabel = targetHub === 'all' ? 'all' : sub.hub;
            const { html, text } = await newsletterTemplate({
              body,
              hub: hubLabel,
              unsubscribeToken: sub.unsubscribe_token,
            });

            await resend.emails.send({
              from: FROM,
              to: sub.email,
              subject: subject.trim(),
              html,
              text,
            });
            sentCount++;
          } catch (err) {
            console.error(`[newsletter] Failed to send to ${sub.email}:`, err);
            failedCount++;
          }
        }

        await sb.from('newsletter_campaigns').update({
          status: 'sent',
          sent_count: sentCount,
          failed_count: failedCount,
          sent_at: new Date().toISOString(),
        }).eq('id', campaignId);
      } catch (err) {
        console.error('[newsletter] Campaign send failed:', err);
        await sb.from('newsletter_campaigns').update({
          status: failedCount > 0 || sentCount > 0 ? 'sent' : 'failed',
          sent_count: sentCount,
          failed_count: failedCount,
          sent_at: new Date().toISOString(),
        }).eq('id', campaignId);
      }
    })();

    return NextResponse.json({ ok: true, campaignId });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
