import { ensureNotComingSoon } from '@/src/lib/shared/comingSoonGuard';

export default async function LiveSessionsSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon('training');
  return <>{children}</>;
}
