import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { safeAdminCallbackOrDefault } from '@/src/lib/shared/safeAdminCallback';
import { AdminLoginClient } from './AdminLoginClient';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

/**
 * Single-page admin auth entry. Replaces the previous chain of
 * /admin (welcome) -> /admin/login (welcome) -> /admin/login (form)
 * -> /login (callbackUrl form). Authenticated admins are routed
 * straight to the dashboard (or to a sanitized callbackUrl deep
 * link if one is present); everyone else gets the credential form
 * inline. The form's OTP step handles the trusted-device flow that
 * admins now share with students.
 *
 * `callbackUrl` is run through `safeAdminCallback` so a recursive
 * value left over from the prior ERR_TOO_MANY_REDIRECTS loop bug
 * (2026-04-24) collapses to the dashboard default instead of being
 * blindly trusted.
 */
export default async function AdminEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const rawCallback = typeof params.callbackUrl === 'string' ? params.callbackUrl : '';
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { role?: string }).role === 'admin') {
    redirect(safeAdminCallbackOrDefault(rawCallback));
  }
  return <AdminLoginClient />;
}
