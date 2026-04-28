import { ensureNotComingSoon } from '@/src/hubs/training/lib/ensureNotComingSoon';

/**
 * Coming-Soon gate for the Training Hub dashboard. Redirects to /signin
 * (which shows the launch countdown) whenever CS is on — catches stale
 * cookies / direct links / admin bypass that would otherwise reach the
 * authed UI despite /api/training/validate refusing new logins.
 */
export default async function DashboardSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon();
  return <>{children}</>;
}
