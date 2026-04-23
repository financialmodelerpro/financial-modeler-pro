import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Backwards-compat redirect. The analytics dashboard moved to
 * /admin/analytics on 2026-04-24 (broader scope: cross-course
 * comparison, session funnels, live-session engagement, certificate
 * issue rates). Nav entry updated; anything still pointing here
 * lands on the new URL without confusion.
 */
export default function AnalyticsRedirect() {
  redirect('/admin/analytics');
}
