import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ensureNotComingSoon } from '@/src/hubs/modeling/lib/ensureNotComingSoon';
import { authOptions } from '@/src/shared/auth/nextauth';
import { isNoPlanLockedOut } from '@/src/shared/entitlements/gate';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';

/**
 * Server gate for the Modeling Hub's authed workspace (REFM and any future
 * platform routed through /refm). Two checks, both server-side so DIRECT-URL
 * access is blocked, not just the dashboard:
 *
 *   1. Coming-Soon gate (existing).
 *   2. No-plan / lapsed gate: a non-admin on the deliberate 'none' state OR a
 *      non-admin whose plan has LAPSED (the 1-month read-only grace has elapsed)
 *      has ZERO access, so the workspace redirects them to get-access
 *      (/choose-plan). A GRACE user (plan expired but still inside the grace
 *      month) is NOT redirected: they keep read-only access to VIEW their
 *      projects (the workspace itself enforces read-only). Admin always bypasses;
 *      a real ACTIVE plan or the unknown-plan safety net passes. Everything is
 *      read LIVE via resolveUserGate (not the JWT) so a just-granted / renewed
 *      plan lets the user straight in and the lapse state is computed from dates.
 *
 * This reuses the resolver + the pure decision (isNoPlanLockedOut) so direct-URL
 * gating and the dashboard cards agree. No gate logic is duplicated.
 */
export default async function RefmLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon();

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  // No session: the client guard (useRequireAuth) sends to sign-in; mirror it
  // server-side so an unauthenticated direct hit never renders the workspace.
  if (!userId) redirect('/signin?bypass=true');

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  if (!isAdmin) {
    const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
    // Locked out by 'none' OR a lapsed plan (grace elapsed). A grace user passes
    // here and lands in the read-only workspace with the renew banner.
    if (isNoPlanLockedOut(gate.planKey, gate.isAdmin, gate.lapseState)) redirect('/choose-plan');
  }

  return <>{children}</>;
}
