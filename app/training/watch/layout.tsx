import { ensureNotComingSoon } from '@/src/lib/shared/comingSoonGuard';

export default async function WatchSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon('training');
  return <>{children}</>;
}
