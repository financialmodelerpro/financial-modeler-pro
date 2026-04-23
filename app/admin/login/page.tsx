import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Backwards-compat redirect. The admin auth flow now lives at /admin
 * directly (FIX 1, 2026-04-23). Anything that links to /admin/login
 * (NextAuth callbackUrl, bookmarks, old emails) lands here and is
 * forwarded so we never run two auth pages in parallel.
 */
export default async function AdminLoginRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : '';
  redirect(callbackUrl ? `/admin?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/admin');
}
