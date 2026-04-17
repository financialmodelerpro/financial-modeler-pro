import { getServerClient } from '@/src/lib/shared/supabase';
import { Resend } from 'resend';
import { newsletterTemplate } from '@/src/lib/email/templates/newsletter';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM_NOREPLY ?? 'noreply@financialmodelerpro.com';
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ContentData {
  title: string;
  description?: string;
  url?: string;
  date?: string;
  extra?: Record<string, string>;
}

function generateEmail(eventType: string, data: ContentData): { subject: string; body: string } {
  const { title, description, url, date, extra } = data;
  const btnStyle = 'display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;';

  switch (eventType) {
    case 'article_published':
      return {
        subject: `New Article: ${title}`,
        body: `<h2>${title}</h2>${description ? `<p>${description}</p>` : ''}<p><a href="${url}" style="${btnStyle}">Read Article &rarr;</a></p>`,
      };
    case 'live_session_scheduled':
      return {
        subject: `Upcoming Live Session: ${title}`,
        body: `<h2>${title}</h2>${description ? `<p>${description}</p>` : ''}${date ? `<p><strong>Date:</strong> ${date}</p>` : ''}${extra?.time ? `<p><strong>Time:</strong> ${extra.time}</p>` : ''}${extra?.platform ? `<p><strong>Platform:</strong> ${extra.platform}</p>` : ''}<p><a href="${url || `${LEARN_URL}/training/dashboard?tab=live-sessions`}" style="${btnStyle}">Join Session &rarr;</a></p>`,
      };
    case 'live_session_recording':
      return {
        subject: `Recording Available: ${title}`,
        body: `<h2>Recording Now Available</h2><p>The recording for <strong>${title}</strong> is now available.</p>${url ? `<p><a href="${url}" style="${btnStyle}">Watch Recording &rarr;</a></p>` : ''}`,
      };
    case 'new_course_session':
      return {
        subject: `New Session Released: ${title}`,
        body: `<h2>${title}</h2>${extra?.course ? `<p>Part of the <strong>${extra.course}</strong> course.</p>` : ''}${description ? `<p>${description}</p>` : ''}<p><a href="${url || LEARN_URL}" style="${btnStyle}">Start Learning &rarr;</a></p>`,
      };
    case 'platform_launch':
      return {
        subject: `Now Live: ${title}`,
        body: `<h2>${title}</h2>${description ? `<p>${description}</p>` : ''}<p><a href="${url || MAIN_URL}" style="${btnStyle}">Try It Now &rarr;</a></p>`,
      };
    case 'new_modeling_module':
      return {
        subject: `New Module: ${title}`,
        body: `<h2>${title}</h2>${description ? `<p>${description}</p>` : ''}<p><a href="${url || MAIN_URL}" style="${btnStyle}">Open Module &rarr;</a></p>`,
      };
    default:
      return { subject: title, body: `<h2>${title}</h2>${description ? `<p>${description}</p>` : ''}` };
  }
}

/**
 * Send an auto newsletter notification. Fire-and-forget - never throws.
 * Call with `void sendAutoNewsletter(...)` to avoid blocking the parent operation.
 */
export async function sendAutoNewsletter(
  eventType: string,
  sourceId: string,
  contentData: ContentData,
): Promise<void> {
  try {
    const sb = getServerClient();

    // 1. Check if this event type is enabled
    const { data: setting } = await sb
      .from('newsletter_auto_settings')
      .select('enabled, target_hub')
      .eq('event_type', eventType)
      .maybeSingle();

    if (!setting?.enabled) return;

    // 2. Check for duplicate (same source already sent)
    const { data: existing } = await sb
      .from('newsletter_campaigns')
      .select('id')
      .eq('campaign_type', 'auto')
      .eq('source_type', eventType)
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) return;

    // 3. Get subscribers (deduplicated by email when target is "all")
    const targetHub = setting.target_hub;
    let subQuery = sb.from('newsletter_subscribers').select('email, hub, unsubscribe_token').eq('status', 'active');
    if (targetHub !== 'all') subQuery = subQuery.eq('hub', targetHub);
    const { data: rawSubs } = await subQuery;

    // Deduplicate: one email per person
    const seen = new Map<string, typeof rawSubs extends (infer T)[] | null ? T : never>();
    for (const sub of (rawSubs ?? [])) {
      if (!seen.has(sub.email)) seen.set(sub.email, sub);
    }
    const subscribers = Array.from(seen.values());

    if (subscribers.length === 0) return;

    // 4. Generate email content
    const { subject, body } = generateEmail(eventType, contentData);

    // 5. Create campaign record
    const { data: campaign, error: campErr } = await sb.from('newsletter_campaigns').insert({
      subject,
      body,
      target_hub: targetHub,
      status: 'sending',
      campaign_type: 'auto',
      source_type: eventType,
      source_id: sourceId,
      created_by: 'system',
    }).select('id').single();

    if (campErr || !campaign) {
      console.error('[auto-newsletter] Failed to create campaign:', campErr?.message);
      return;
    }

    // 6. Send emails
    let sentCount = 0;
    let failedCount = 0;

    for (const sub of subscribers) {
      try {
        const { html, text } = await newsletterTemplate({
          body,
          hub: sub.hub,
          unsubscribeToken: sub.unsubscribe_token,
        });
        await resend.emails.send({ from: FROM, to: sub.email, subject, html, text });
        sentCount++;
      } catch (err) {
        console.error(`[auto-newsletter] Failed to send to ${sub.email}:`, err);
        failedCount++;
      }
    }

    // 7. Update campaign
    await sb.from('newsletter_campaigns').update({
      status: 'sent',
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
    }).eq('id', campaign.id);

    console.log(`[auto-newsletter] ${eventType}: sent ${sentCount}, failed ${failedCount}`);
  } catch (err) {
    console.error(`[auto-newsletter] ${eventType} error:`, err);
  }
}
