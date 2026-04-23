import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Backwards-compat redirect. Admin auth now lives at /admin directly
 * (FIX 1, 2026-04-23). Anything still linking to /login lands here
 * and is forwarded.
 */
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : '';
  redirect(callbackUrl ? `/admin?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/admin');
}
