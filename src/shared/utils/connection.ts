/**
 * connection.ts (2026-09-24)
 *
 * IS THIS BROWSER OFFLINE? The one answer, for every guard that would
 * otherwise send an offline user to sign in.
 *
 * Offline, the session request fails, and NextAuth reports a failed session
 * request as "unauthenticated". Every Modeling Hub guard reads that as
 * "signed out" and redirects to sign-in, which cannot work without a
 * connection and tells the user the wrong thing (their session is fine, their
 * network is not). A guard asks this first and, when offline, leaves the user
 * where they are for the offline notice to explain.
 *
 * `navigator.onLine === false` is RELIABLE for "offline" (true is only a hint,
 * which is why this never claims the opposite). On the server it is false.
 *
 * No em dashes in this file.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
