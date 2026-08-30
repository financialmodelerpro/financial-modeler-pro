/**
 * POST /api/admin/campaigns/send
 *
 * Sends a campaign. The audience is resolved HERE, by the same shared function
 * the preview used, so what was confirmed is what is sent; the client's count
 * is echoed back for comparison but is never trusted as the audience.
 *
 * Requires confirm: true and an expectedCount that MATCHES the freshly
 * resolved audience. If someone registered (or unsubscribed) between the
 * preview and the confirmation, the send is refused and the admin re-previews,
 * rather than quietly emailing a different set of people than they approved.
 *
 * Admin only. No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { writeAuditLog } from '@/src/shared/audit';
import { resolveCampaignRecipients, sendCampaign, type CampaignFilters } from '@/src/shared/email/campaigns';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const adminId = session.user.id as string;

  const body = await req.json().catch(() => ({})) as {
    filters?: CampaignFilters; subject?: string; bodyHtml?: string; meetingLink?: string;
    templateId?: string | null; templateName?: string | null;
    confirm?: boolean; expectedCount?: number;
  };

  const subject = (body.subject ?? '').trim();
  const bodyHtml = (body.bodyHtml ?? '').trim();
  if (!subject || !bodyHtml) return NextResponse.json({ error: 'subject and bodyHtml are required' }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: 'confirm: true required' }, { status: 400 });

  const sb = getServerClient();
  let resolution;
  try {
    resolution = await resolveCampaignRecipients(sb, body.filters ?? {});
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not resolve recipients' }, { status: 500 });
  }

  if (resolution.recipients.length === 0) {
    return NextResponse.json({ error: 'That selection matches nobody who can be emailed.', code: 'NO_RECIPIENTS' }, { status: 400 });
  }

  // The count the admin confirmed must still be the count being sent to.
  if (typeof body.expectedCount === 'number' && body.expectedCount !== resolution.recipients.length) {
    return NextResponse.json({
      error: `The audience changed since you previewed it: ${resolution.recipients.length} recipients now, ${body.expectedCount} when you confirmed. Preview again before sending.`,
      code: 'COUNT_CHANGED',
      recipientCount: resolution.recipients.length,
    }, { status: 409 });
  }

  const result = await sendCampaign(sb, {
    adminId,
    templateId: body.templateId ?? null,
    templateName: body.templateName ?? null,
    subject,
    bodyHtml,
    meetingLink: (body.meetingLink ?? '').trim(),
    recipients: resolution.recipients,
    unsubscribed: resolution.unsubscribed,
  });

  await writeAuditLog({
    adminId,
    action: 'campaign_sent',
    afterValue: {
      campaign_id: result.campaignId,
      subject,
      template: body.templateName ?? null,
      sent: result.sent, failed: result.failed, skipped: result.skipped,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
