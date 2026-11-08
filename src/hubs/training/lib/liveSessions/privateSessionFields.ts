/**
 * The ONE rule for which live_sessions columns are private.
 *
 * A join link, its password and the Teams dial-in let anyone into the meeting,
 * so they reach a browser only through a route that has checked the signed
 * student is registered for that session. Every route that returns a session
 * row to an unchecked caller goes through `withoutPrivateFields`.
 */

export const PRIVATE_SESSION_FIELDS = [
  'live_url',
  'live_password',
  'teams_dial_in',
  'teams_meeting_id',
] as const;

export type PrivateSessionField = (typeof PRIVATE_SESSION_FIELDS)[number];

/**
 * Drops the private columns and adds `has_live_url`, so a caller can still
 * tell a session has a meeting link without seeing it.
 */
export function withoutPrivateFields<T extends Record<string, unknown>>(
  row: T,
): Omit<T, PrivateSessionField> & { has_live_url: boolean } {
  const out: Record<string, unknown> = { ...row };
  for (const f of PRIVATE_SESSION_FIELDS) delete out[f];
  out.has_live_url = typeof row.live_url === 'string' && row.live_url.trim().length > 0;
  return out as Omit<T, PrivateSessionField> & { has_live_url: boolean };
}

/** The join details a REGISTERED student may receive, or nulls. */
export function joinDetailsFor(
  registered: boolean,
  session: { live_url?: string | null; live_password?: string | null } | null | undefined,
): { liveUrl: string | null; livePassword: string | null } {
  if (!registered || !session) return { liveUrl: null, livePassword: null };
  return {
    liveUrl:      session.live_url?.trim() || null,
    livePassword: session.live_password?.trim() || null,
  };
}

/**
 * The link a PUBLIC announcement (newsletter) points at: the public session
 * page, which sends a visitor to sign in or register. Never the join link.
 */
export function publicSessionUrl(learnUrl: string, sessionId: string): string {
  return `${learnUrl.replace(/\/$/, '')}/training-sessions/${sessionId}`;
}

/** Plain platform name for an announcement, from the meeting provider. */
export function sessionPlatformLabel(provider: string | null | undefined): string {
  switch (provider) {
    case 'teams': return 'Microsoft Teams';
    case 'zoom':  return 'Zoom';
    case 'meet':  return 'Google Meet';
    default:      return 'Live online';
  }
}
