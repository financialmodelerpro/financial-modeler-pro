import { ensureNotComingSoon } from '@/src/lib/shared/comingSoonGuard';

/**
 * Gates the legacy in-course URLs (/training/3sfm, /training/bvm, …). The
 * dashboard already covers the primary entry point; this layout closes the
 * stale-cookie / deep-link path to course content.
 */
export default async function CourseSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon('training');
  return <>{children}</>;
}
