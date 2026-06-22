import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { resolveTrialDays, trialEndsAtIso } from '@/src/shared/entitlements/trialConfig';
import { writeAuditLog } from '@/src/shared/audit';

// Trial approval (Phase C): place a user on the Trial plan with an expiry.
// Sets subscription_plan = 'trial', subscription_status = 'trial', and
// trial_ends_at = now + configured trial duration. The duration is read from
// config (platform_pricing.trial_days, fallback DEFAULT_TRIAL_DAYS), never
// hardcoded inline. No gate change: this only writes the users row.

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function POST(req: NextRequest) {
  const session = await checkAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { user_id, platform = 'real-estate' } = await req.json() as { user_id: string; platform?: string };
    if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
    const sb = getServerClient();

    const { data: current, error: fErr } = await sb
      .from('users')
      .select('subscription_plan, subscription_status, trial_ends_at')
      .eq('id', user_id)
      .single();
    if (fErr || !current) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const days = await resolveTrialDays(sb, platform);
    const endsAt = trialEndsAtIso(Date.now(), days);

    const { error } = await sb.from('users').update({
      subscription_plan: 'trial',
      subscription_status: 'trial',
      trial_ends_at: endsAt,
      updated_at: new Date().toISOString(),
    }).eq('id', user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      adminId: (session.user as { id: string }).id,
      action: 'trial_approval',
      targetUserId: user_id,
      beforeValue: { plan: current.subscription_plan, status: current.subscription_status, trial_ends_at: current.trial_ends_at },
      afterValue: { plan: 'trial', status: 'trial', trial_ends_at: endsAt },
    });

    return NextResponse.json({ ok: true, trial_ends_at: endsAt, trialDays: days });
  } catch {
    return NextResponse.json({ error: 'Failed to approve trial' }, { status: 500 });
  }
}
