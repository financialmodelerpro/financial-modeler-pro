import { ensureNotComingSoon } from '@/src/hubs/training/lib/ensureNotComingSoon';

export default async function LiveSessionsSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon();
  return <>{children}</>;
}
