import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { startTrialForUser } from '@/src/shared/entitlements/trialRequests';

// POST /api/refm/trial
//
// The signed-in user's "Start free trial" action. Self-serve by default
// (grants the trial immediately via the shared setUserPlan); when the admin
// toggle "Trial requires approval" is on, it queues a request instead. No plan
// logic is duplicated here, and admins are unaffected (they already have access).

const PLATFORM = 'real-estate';

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const result = await startTrialForUser(sb, userId, PLATFORM);
  if (!result.ok) {
    // A Paddle-billed user blocked from self-moving to trial is a 409 (conflict),
    // not a 500: the directing message tells them to use the billing flow.
    const status = result.code === 'paddle_billed' ? 409 : 500;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
