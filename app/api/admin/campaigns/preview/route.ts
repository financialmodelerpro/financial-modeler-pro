/**
 * POST /api/admin/campaigns/preview
 *
 * Resolves the audience AND renders the email exactly as a recipient will see
 * it, in one call, so the confirmation step can state a count that came from
 * the same resolution the send will use rather than a separate estimate.
 *
 * The preview is rendered against the FIRST real recipient when there is one,
 * so the merge fields show real substitution rather than placeholder text that
 * hides an empty company or a missing name.
 *
 * Sends nothing. Admin only. No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import {
  resolveCampaignRecipients, renderCampaign, unsubscribeUrl,
  type CampaignFilters,
} from '@/src/shared/email/campaigns';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    filters?: CampaignFilters; subject?: string; bodyHtml?: string; meetingLink?: string;
  };
  const subject = (body.subject ?? '').trim();
  const bodyHtml = (body.bodyHtml ?? '').trim();
  if (!subject || !bodyHtml) return NextResponse.json({ error: 'subject and bodyHtml are required' }, { status: 400 });

  const sb = getServerClient();
  let resolution;
  try {
    resolution = await resolveCampaignRecipients(sb, body.filters ?? {});
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not resolve recipients' }, { status: 500 });
  }

  const sample = resolution.recipients[0] ?? null;
  const html = await renderCampaign(bodyHtml, {
    name: sample?.name ?? null,
    company: sample?.company ?? null,
    meetingLink: (body.meetingLink ?? '').trim(),
    unsubscribeUrl: unsubscribeUrl(sample?.id ?? 'preview'),
  });

  return NextResponse.json({
    subject,
    html,
    previewFor: sample ? { email: sample.email, name: sample.name, company: sample.company } : null,
    recipientCount: resolution.recipients.length,
    unsubscribedCount: resolution.unsubscribed.length,
    adminsExcluded: resolution.adminsExcluded,
    recipients: resolution.recipients.slice(0, 200).map((r) => ({ id: r.id, email: r.email, name: r.name })),
  });
}
