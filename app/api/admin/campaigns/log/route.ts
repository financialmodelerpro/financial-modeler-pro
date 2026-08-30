/**
 * GET /api/admin/campaigns/log
 *
 * The send log, newest first, grouped into campaigns with their per-recipient
 * rows. Answers the question the log exists for: who sent what, to whom, when,
 * and what happened to each one, including the failures and the recipients
 * skipped because they had unsubscribed.
 *
 * Admin only, read-only. No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

interface SendRow {
  campaign_id: string; admin_id: string | null; template_name: string | null;
  subject: string; recipient_email: string; recipient_user_id: string | null;
  status: string; error: string | null; created_at: string;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const limit = Math.min(2000, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '500', 10)));
  const sb = getServerClient();
  const { data, error } = await sb
    .from('admin_campaign_sends')
    .select('campaign_id, admin_id, template_name, subject, recipient_email, recipient_user_id, status, error, created_at')
    .order('created_at', { ascending: false })
    .range(0, limit - 1);
  if (error) {
    return NextResponse.json({ error: 'The campaign log is unavailable. Apply migration 225.', code: 'MIGRATION_PENDING', detail: error.message }, { status: 503 });
  }

  const rows = (data ?? []) as SendRow[];

  // Name the sending admin without a join: the log deliberately stores no
  // admin name (it would go stale), so it is looked up at read time.
  const adminIds = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))] as string[];
  const adminNames = new Map<string, string>();
  if (adminIds.length > 0) {
    const { data: admins } = await sb.from('users').select('id, email, name').in('id', adminIds);
    for (const a of (admins ?? []) as Array<{ id: string; email: string; name: string | null }>) {
      adminNames.set(a.id, a.name?.trim() || a.email);
    }
  }

  const byCampaign = new Map<string, {
    campaignId: string; subject: string; templateName: string | null;
    sentBy: string; sentAt: string;
    sent: number; failed: number; skipped: number;
    rows: Array<{ email: string; status: string; error: string | null }>;
  }>();

  for (const r of rows) {
    let c = byCampaign.get(r.campaign_id);
    if (!c) {
      c = {
        campaignId: r.campaign_id, subject: r.subject, templateName: r.template_name,
        sentBy: (r.admin_id && adminNames.get(r.admin_id)) || 'unknown',
        sentAt: r.created_at, sent: 0, failed: 0, skipped: 0, rows: [],
      };
      byCampaign.set(r.campaign_id, c);
    }
    if (r.status === 'sent') c.sent++;
    else if (r.status === 'failed') c.failed++;
    else c.skipped++;
    c.rows.push({ email: r.recipient_email, status: r.status, error: r.error });
  }

  return NextResponse.json({ campaigns: [...byCampaign.values()], totalRows: rows.length });
}
