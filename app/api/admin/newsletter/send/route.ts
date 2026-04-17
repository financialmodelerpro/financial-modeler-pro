import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { Resend } from 'resend';
import { newsletterTemplate } from '@/src/lib/email/templates/newsletter';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM_NOREPLY ?? 'noreply@financialmodelerpro.com';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
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

    // Create campaign record
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

    // Return immediately, send in background
    const campaignId = campaign.id;

    // Fire-and-forget sending
    (async () => {
      try {
        let query = sb.from('newsletter_subscribers').select('email, hub, unsubscribe_token').eq('status', 'active');
        if (targetHub !== 'all') query = query.eq('hub', targetHub);
        const { data: subscribers } = await query;

        let sentCount = 0;
        let failedCount = 0;

        for (const sub of (subscribers ?? [])) {
          try {
            const { html, text } = await newsletterTemplate({
              body,
              hub: sub.hub,
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
          status: 'failed',
        }).eq('id', campaignId);
      }
    })();

    return NextResponse.json({ ok: true, campaignId });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
