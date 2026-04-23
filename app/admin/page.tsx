import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { AdminLoginClient } from './AdminLoginClient';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

/**
 * Single-page admin auth entry.
 *
 *  - Authenticated admin           -> 307 to /admin/dashboard
 *  - Unauthenticated (or non-admin) -> render the credential form inline
 *
 * Deliberately does NOT read searchParams. No callbackUrl plumbing,
 * no sanitization, no conditionals beyond the session check. Users
 * who want a deep link can bookmark after signing in.
 */
export default async function AdminEntryPage() {
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { role?: string }).role === 'admin') {
    redirect('/admin/dashboard');
  }
  return <AdminLoginClient />;
}
