import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { AdminLoginClient } from './AdminLoginClient';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

/**
 * Single-page admin auth entry. Replaces the previous chain of
 * /admin (welcome) -> /admin/login (welcome) -> /admin/login (form)
 * -> /login (callbackUrl form). Authenticated admins are routed
 * straight to the dashboard; everyone else gets the credential form
 * inline (FIX 1, 2026-04-23). The form's OTP step (FIX 2) handles
 * the new trusted-device flow that admins now share with students.
 */
export default async function AdminEntryPage() {
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { role?: string }).role === 'admin') {
    redirect('/admin/dashboard');
  }
  return <AdminLoginClient />;
}
