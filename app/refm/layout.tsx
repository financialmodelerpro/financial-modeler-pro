import { ensureNotComingSoon } from '@/src/lib/shared/comingSoonGuard';

/**
 * Coming-Soon gate for the Modeling Hub's authed surface (REFM and any
 * future platform page routed through /refm). Redirects to /signin,
 * which itself shows the Modeling Hub launch countdown while CS is on.
 *
 * Catches the stale-NextAuth-JWT case: `authorize()` refuses new logins
 * during CS, but tokens issued before the toggle was flipped remain valid
 * for their 1-hour maxAge. This guard closes that window.
 */
export default async function RefmLayout({ children }: { children: React.ReactNode }) {
  await ensureNotComingSoon('modeling');
  return <>{children}</>;
}
