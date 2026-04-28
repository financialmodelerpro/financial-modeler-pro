import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendCampaign } from '@/src/shared/newsletter/sender';
import { getTemplate, renderTemplate, type TemplateVars } from '@/src/shared/newsletter/templates';
import type { SegmentKey } from '@/src/shared/newsletter/segments';

interface SendBody {
  /** Direct subject + body (manual compose path). Mutually exclusive with templateKey. */
  subject?: string;
  body?: string;
  /** Use a stored template; vars interpolated server-side. */
  templateKey?: string;
  templateVars?: TemplateVars;
  /** Recipient targeting. */
  targetHub?: 'training' | 'modeling' | 'all';
  segment?: SegmentKey;
  /**
   * If set to a future ISO datetime, the campaign is created with status='scheduled'
   * and the cron route will pick it up. Otherwise the send fires immediately
   * (fire-and-forget).
   */
  scheduledAt?: string | null;
}

const VALID_SEGMENTS: SegmentKey[] = [
  'all_active', 'active_30_days', 'passed_3sfm', 'passed_bvm',
  'never_started', 'has_certificate', 'no_certificate',
];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = (session?.user as { email?: string; role?: string } | undefined);
  if (adminEmail?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: SendBody;
  try { payload = await req.json() as SendBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const targetHub = payload.targetHub ?? 'all';
  if (!['training', 'modeling', 'all'].includes(targetHub)) {
    return NextResponse.json({ error: 'Invalid targetHub' }, { status: 400 });
  }

  const segment = payload.segment ?? 'all_active';
  if (!VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }

  // Resolve subject + body from either direct fields or template lookup
  let subject = payload.subject?.trim() ?? '';
  let body = payload.body ?? '';

  if (payload.templateKey) {
    const tpl = await getTemplate(payload.templateKey);
    if (!tpl) return NextResponse.json({ error: `Template not found: ${payload.templateKey}` }, { status: 404 });
    const rendered = renderTemplate(tpl, payload.templateVars ?? {});
    subject = rendered.subject;
    body = rendered.body;
  }

  if (!subject || !body) {
    return NextResponse.json({ error: 'subject and body (or templateKey) required' }, { status: 400 });
  }

  // Schedule path: just store the campaign as 'scheduled', cron picks it up.
  const sb = getServerClient();
  const scheduledAt = payload.scheduledAt && new Date(payload.scheduledAt).getTime() > Date.now()
    ? new Date(payload.scheduledAt).toISOString()
    : null;

  const { data: campaign, error: insertErr } = await sb.from('newsletter_campaigns').insert({
    subject,
    body,
    target_hub: targetHub,
    segment,
    status:       scheduledAt ? 'scheduled' : 'sending',
    scheduled_at: scheduledAt,
    created_by:   adminEmail?.email ?? 'admin',
  }).select('id').single();

  if (insertErr || !campaign) {
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }

  if (scheduledAt) {
    return NextResponse.json({ ok: true, campaignId: campaign.id, scheduled: true, scheduledAt });
  }

  // Fire and forget the actual send
  void sendCampaign({
    campaignId: campaign.id,
    subject,
    body,
    targetHub,
    segment,
  }).catch(err => {
    console.error('[newsletter-send] fire-and-forget send failed:', err);
  });

  return NextResponse.json({ ok: true, campaignId: campaign.id });
}
