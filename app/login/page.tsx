import { redirect } from 'next/navigation';
import { safeAdminCallback } from '@/src/lib/shared/safeAdminCallback';

export const dynamic = 'force-dynamic';

/**
 * Backwards-compat redirect. Admin auth now lives at /admin directly
 * (FIX 1, 2026-04-23). Anything still linking to /login lands here
 * and is forwarded.
 *
 * `callbackUrl` is sanitized so a malformed value (auth-cycle path,
 * nested encoding from the prior loop bug, open-redirect attempt) is
 * dropped instead of preserved (FIX 2026-04-24).
 */
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = typeof params.callbackUrl === 'string' ? params.callbackUrl : '';
  const sanitized = safeAdminCallback(raw);
  // sanitized=null means the original was malformed; drop it.
  if (!sanitized) {
    redirect('/admin');
  }
  redirect(`/admin?callbackUrl=${encodeURIComponent(sanitized)}`);
}
