import { ensureNotComingSoon } from '@/src/hubs/training/lib/ensureNotComingSoon';

export default async function WatchSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon();
  return <>{children}</>;
}
