/**
 * Event-driven newsletter dispatch (article publish, live session schedule
 * / recording, course session release, platform launch, modeling module
 * release). Fire-and-forget; never throws so a publish workflow doesn't
 * roll back when an email fails.
 *
 * Pipeline (mirrors manual compose path):
 *   1. Lookup auto-setting for this event_type, bail if disabled.
 *   2. Dedupe via existing campaign (same source_type + source_id).
 *   3. Render subject + body via newsletter_templates table
 *      (`renderForEvent`) - falls back to a hardcoded shell if no template
 *      exists yet. This eliminates the manual-vs-auto template drift bug.
 *   4. Create the campaign row.
 *   5. Hand off to `sendCampaign()` so the same batch + recipient_log +
 *      retry path applies as manual sends.
 */
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendCampaign } from './sender';
import { renderForEvent, type TemplateVars } from './templates';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ContentData {
  title: string;
  description?: string;
  url?: string;
  date?: string;
  extra?: Record<string, string>;
}

/**
 * Hardcoded fallback used only when the templates table is empty for an
 * event type (first-run before migration 143 seeds, or after manual
 * deletion). Keep the markup minimal - the branded shell adds the rest.
 */
function fallbackEmail(eventType: string, data: ContentData): { subject: string; body: string } {
  const { title, description, url, date, extra } = data;
  const btnStyle = 'display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;';
  const desc = description ? `<p>${description}</p>` : '';

  switch (eventType) {
    case 'article_published':
      return {
        subject: `New Article: ${title}`,
        body: `<h2>${title}</h2>${desc}<p><a href="${url ?? MAIN_URL}" style="${btnStyle}">Read Article &rarr;</a></p>`,
      };
    case 'live_session_scheduled':
      return {
        subject: `Upcoming Live Session: ${title}`,
        body: `<h2>${title}</h2>${desc}${date ? `<p><strong>Date:</strong> ${date}</p>` : ''}${extra?.time ? `<p><strong>Time:</strong> ${extra.time}</p>` : ''}${extra?.platform ? `<p><strong>Platform:</strong> ${extra.platform}</p>` : ''}<p><a href="${url ?? `${LEARN_URL}/training/dashboard?tab=live-sessions`}" style="${btnStyle}">Join Session &rarr;</a></p>`,
      };
    case 'live_session_recording':
      return {
        subject: `Recording Available: ${title}`,
        body: `<h2>Recording Now Available</h2><p>The recording for <strong>${title}</strong> is now available.</p>${url ? `<p><a href="${url}" style="${btnStyle}">Watch Recording &rarr;</a></p>` : ''}`,
      };
    case 'new_course_session':
      return {
        subject: `New Session Released: ${title}`,
        body: `<h2>${title}</h2>${extra?.course ? `<p>Part of the <strong>${extra.course}</strong> course.</p>` : ''}${desc}<p><a href="${url ?? LEARN_URL}" style="${btnStyle}">Start Learning &rarr;</a></p>`,
      };
    case 'platform_launch':
      return {
        subject: `Now Live: ${title}`,
        body: `<h2>${title}</h2>${desc}<p><a href="${url ?? MAIN_URL}" style="${btnStyle}">Try It Now &rarr;</a></p>`,
      };
    case 'new_modeling_module':
      return {
        subject: `New Module: ${title}`,
        body: `<h2>${title}</h2>${desc}<p><a href="${url ?? MAIN_URL}" style="${btnStyle}">Open Module &rarr;</a></p>`,
      };
    default:
      return { subject: title, body: `<h2>${title}</h2>${desc}` };
  }
}

function buildVars(data: ContentData): TemplateVars {
  return {
    title:       data.title,
    description: data.description ?? '',
    url:         data.url ?? '',
    date:        data.date ?? '',
    time:        data.extra?.time ?? '',
    platform:    data.extra?.platform ?? '',
    course:      data.extra?.course ?? '',
  };
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

    const { data: setting } = await sb
      .from('newsletter_auto_settings')
      .select('enabled, target_hub')
      .eq('event_type', eventType)
      .maybeSingle();

    if (!setting?.enabled) return;

    // Duplicate prevention - only one campaign per (event_type, source_id)
    const { data: existing } = await sb
      .from('newsletter_campaigns')
      .select('id')
      .eq('campaign_type', 'auto')
      .eq('source_type', eventType)
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) return;

    const targetHub: 'training' | 'modeling' | 'all' = setting.target_hub ?? 'all';

    // 1. Render via template engine (DB-backed); fall back to hardcoded
    //    if the templates table has no row for this event yet.
    const vars = buildVars(contentData);
    const rendered = await renderForEvent(eventType, vars) ?? fallbackEmail(eventType, contentData);

    // 2. Create campaign record so we have a campaign_id for the recipient log.
    const { data: campaign, error: campErr } = await sb.from('newsletter_campaigns').insert({
      subject:       rendered.subject,
      body:          rendered.body,
      target_hub:    targetHub,
      segment:       'all_active',
      status:        'sending',
      campaign_type: 'auto',
      source_type:   eventType,
      source_id:     sourceId,
      created_by:    'system',
    }).select('id').single();

    if (campErr || !campaign) {
      console.error('[auto-newsletter] Failed to create campaign:', campErr?.message);
      return;
    }

    // 3. Hand off to the shared sender so we get batch + recipient log + retries.
    const result = await sendCampaign({
      campaignId: campaign.id,
      subject:    rendered.subject,
      body:       rendered.body,
      targetHub,
      segment:    'all_active',
    });

    console.log(`[auto-newsletter] ${eventType}: sent ${result.sent}, failed ${result.failed}`);
  } catch (err) {
    console.error(`[auto-newsletter] ${eventType} error:`, err);
  }
}
