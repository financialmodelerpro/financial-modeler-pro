/**
 * Per-campaign read + delete + cancel.
 *
 * GET returns the campaign + per-recipient log + click stats. Used by the
 * Campaigns sub-tab analytics view. DELETE allows admins to drop a draft
 * or cancelled campaign. PATCH is reserved for state transitions (cancel
 * a scheduled campaign before it fires).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

interface RecipientRow {
  id: string;
  email: string;
  status: string;
  resend_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const sb = getServerClient();

  const { data: campaign } = await sb.from('newsletter_campaigns').select('*').eq('id', id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: recipients } = await sb
    .from('newsletter_recipient_log')
    .select('*')
    .eq('campaign_id', id)
    .order('email', { ascending: true });

  const rows = (recipients ?? []) as RecipientRow[];
  const totals = {
    sent:       rows.filter(r => ['sent', 'opened', 'clicked'].includes(r.status)).length,
    failed:     rows.filter(r => r.status === 'failed').length,
    bounced:    rows.filter(r => r.status === 'bounced').length,
    complained: rows.filter(r => r.status === 'complained').length,
    opened:     rows.filter(r => r.opened_at != null).length,
    clicked:    rows.filter(r => r.clicked_at != null).length,
    pending:    rows.filter(r => r.status === 'pending').length,
    total:      rows.length,
  };
  const openRate  = totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 1000) / 10 : 0;
  const clickRate = totals.sent > 0 ? Math.round((totals.clicked / totals.sent) * 1000) / 10 : 0;

  return NextResponse.json({ campaign, recipients: rows, totals, openRate, clickRate });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const { action } = await req.json() as { action: 'cancel' };
    if (action !== 'cancel') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    const sb = getServerClient();
    const { data: campaign } = await sb.from('newsletter_campaigns').select('status').eq('id', id).maybeSingle();
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (campaign.status !== 'scheduled') {
      return NextResponse.json({ error: `Cannot cancel a ${campaign.status} campaign` }, { status: 400 });
    }
    await sb.from('newsletter_campaigns').update({ status: 'cancelled' }).eq('id', id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const sb = getServerClient();
  // Cascade delete via FK will remove recipient log rows
  const { error } = await sb.from('newsletter_campaigns').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
