/**
 * GET /api/refm/entitlements
 *
 * Returns the signed-in user's RESOLVED gate (feature access map + project
 * cap + archive allowance), computed server-side against the LIVE users row
 * via resolveUserGate (which reuses the Phase C resolver). The REFM client
 * fetches this once on load to drive canAccess and the cap UI.
 *
 * Fail-closed: resolveUserGate never throws; on a resolution error it returns
 * a denied gate (admin still bypasses). This route just shapes the response.
 *
 * No gate decision is duplicated here; the client trusts this map for UX, and
 * the server choke points (project create / archive / versions) re-resolve
 * independently so the boundary is server-authoritative, not client-trusting.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? (await getRefmUserId());
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sessionIsAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  const gate = await resolveUserGate(userId, { sessionIsAdmin });

  // Shape a compact response: the client needs the feature map, cap facts,
  // admin/full-access flags, and trial state. user_permissions detail stays
  // server-side.
  return NextResponse.json({
    isAdmin: gate.isAdmin,
    fullAccess: gate.fullAccess,
    planKey: gate.planKey,
    knownPlan: gate.knownPlan,
    trialExpired: gate.trialExpired,
    trialEndsAt: gate.trialEndsAt,
    // Three-state lapse model: 'active' | 'grace' (read-only) | 'lapsed'.
    lapseState: gate.lapseState,
    readOnly: gate.readOnly,
    accessExpiresAt: gate.accessExpiresAt,
    graceEndsAt: gate.graceEndsAt,
    featureMap: gate.featureMap,
    projectLimit: gate.projectLimit,
    archiveAllowed: gate.archiveAllowed,
    activeProjectCount: gate.activeProjectCount,
    error: gate.error,
  });
}
