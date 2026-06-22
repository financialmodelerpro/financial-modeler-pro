import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';

// Assign a user to any entitlement plan (Trial / Solo / Pro / Firm). THE single
// shared plan-setting path: both /admin/users (inline) and /admin/access (plan
// selector) call this, which delegates to setUserPlan (one code path). Writes
// new plan keys only (validated against entitlement_plans); never legacy names.

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function POST(req: NextRequest) {
  const session = await checkAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { user_id, plan_key, platform = 'real-estate' } = await req.json() as { user_id: string; plan_key: string; platform?: string };
    const sb = getServerClient();
    const adminId = (session.user as { id?: string }).id ?? null;
    const res = await setUserPlan(sb, user_id, plan_key, { platform, adminId });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus, trialEndsAt: res.trialEndsAt });
  } catch {
    return NextResponse.json({ error: 'Failed to set plan' }, { status: 500 });
  }
}
