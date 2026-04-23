import { redirect } from 'next/navigation';
import { safeAdminCallback } from '@/src/lib/shared/safeAdminCallback';

export const dynamic = 'force-dynamic';

/**
 * Backwards-compat redirect. The admin auth flow now lives at /admin
 * directly (FIX 1, 2026-04-23). Anything that links to /admin/login
 * (NextAuth callbackUrl, bookmarks, old emails) lands here and is
 * forwarded so we never run two auth pages in parallel.
 *
 * `callbackUrl` is run through `safeAdminCallback` so a malformed
 * value (e.g. one that points back to /admin or contains nested
 * encoding from the prior loop bug) is dropped - we redirect plain
 * to /admin instead of preserving the bad parameter (FIX 2026-04-24).
 */
export default async function AdminLoginRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = typeof params.callbackUrl === 'string' ? params.callbackUrl : '';
  const sanitized = safeAdminCallback(raw);
  // sanitized=null means the original was malformed (loop, off-origin,
  // or pointed back into the auth cycle); drop it and redirect plain.
  if (!sanitized) {
    redirect('/admin');
  }
  redirect(`/admin?callbackUrl=${encodeURIComponent(sanitized)}`);
}
