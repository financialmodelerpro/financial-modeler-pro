/**
 * Which pages are PUBLIC MARKETING pages. One list for every main-site overlay
 * (the promo popup and the logo intro), so the two cannot disagree. Pure.
 *
 * A path is a marketing page unless it is, or sits under, one of these.
 */
export const NON_MARKETING_PREFIXES = [
  '/pricing', '/admin', '/dashboard', '/refm', '/modeling', '/modeling-hub',
  '/training', '/settings', '/account', '/choose-plan',
  '/signin', '/register', '/login', '/forgot', '/set-password', '/confirm-email', '/verify',
] as const;

export function isMarketingPath(pathname: string | null | undefined): boolean {
  const path = pathname || '/';
  return !NON_MARKETING_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
