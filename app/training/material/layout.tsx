import { ensureNotComingSoon } from '@/src/lib/shared/comingSoonGuard';

export default async function MaterialSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon('training');
  return <>{children}</>;
}
