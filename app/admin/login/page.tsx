import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Dumb one-shot redirect to the unified admin auth entry.
 *
 * Deliberately does NOT read searchParams or preserve callbackUrl
 * (2026-04-24, same reasoning as `app/login/page.tsx`). The
 * middleware is the only caller that needs a fresh callbackUrl to
 * preserve a legitimate deep link; it writes that itself when it
 * bounces an unauthed user to `/admin`, so nothing carried through
 * this forwarder would be load-bearing.
 */
export default function AdminLoginRedirect() {
  redirect('/admin');
}
