import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ensureNotComingSoon } from '@/src/hubs/modeling/lib/ensureNotComingSoon';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { isNoPlanLockedOut } from '@/src/shared/entitlements/gate';

/**
 * Server gate for the Modeling Hub's authed workspace (REFM and any future
 * platform routed through /refm). Two checks, both server-side so DIRECT-URL
 * access is blocked, not just the dashboard:
 *
 *   1. Coming-Soon gate (existing).
 *   2. No-plan gate (foundation): a non-admin on the deliberate 'none' state has
 *      ZERO access, so the workspace itself redirects them to get-access
 *      (/modeling/choose-plan). Admin always bypasses; a real plan or the
 *      unknown-plan safety net passes. The plan is read LIVE from the users row
 *      (not the JWT) so a just-granted trial/purchase lets the user straight in.
 *
 * This reuses the foundation's pure decision (isNoPlanLockedOut) so direct-URL
 * gating and the dashboard cards agree. No resolver logic is duplicated.
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
    const sb = getServerClient();
    const { data } = await sb.from('users').select('subscription_plan').eq('id', userId).maybeSingle();
    const planKey = (data as { subscription_plan?: string } | null)?.subscription_plan ?? '';
    if (isNoPlanLockedOut(planKey, isAdmin)) redirect('/modeling/choose-plan');
  }

  return <>{children}</>;
}
