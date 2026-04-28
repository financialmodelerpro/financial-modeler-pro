import { ensureNotComingSoon } from '@/src/hubs/training/lib/ensureNotComingSoon';

export default async function TranscriptSegmentLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon();
  return <>{children}</>;
}
