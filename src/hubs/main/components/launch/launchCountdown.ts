/**
 * launchCountdown.ts (pure, no React, no database, no next imports)
 *
 * The decision layer for the launch countdown banner: WHICH date drives it,
 * WHETHER it should show, and WHERE it is allowed to appear. Kept free of
 * React and of the Supabase client so the verifier can exercise every rule
 * directly instead of asserting on source text.
 *
 * The banner is gated on the DATE ALONE, deliberately. It shows while the
 * launch date is in the future and stops the moment that date passes, so it
 * needs no second switch to turn it off and cannot get stuck on. The
 * `modeling_hub_coming_soon` flag is NOT consulted: once the date passes the
 * banner is gone whatever that flag says, and before the date the announcement
 * is still true.
 *
 * No em dashes in this file.
 */

/** The settings key that drives the banner: the hub-level launch date.
 *
 *  This is the same key `/api/cron/auto-launch-check` reads, so the countdown
 *  a visitor sees and the moment the hub actually flips are one date, not two
 *  that can drift. It is edited on /admin/modules (Modeling Hub Launch) through
 *  the existing /api/admin/modeling-coming-soon route.
 *
 *  Note for whoever reads this next: the per-surface keys
 *  `modeling_hub_signin_launch_date` and `modeling_hub_register_launch_date`
 *  are a DIFFERENT thing. They gate the sign-in and register pages and drive
 *  the countdown inside ModelingComingSoon. This banner intentionally does not
 *  read them, so an admin can stage the public announcement separately from
 *  when the auth pages open. */
export const LAUNCH_DATE_KEY = 'modeling_hub_launch_date';

/** Admin-editable banner copy, and which platform the launch is FOR.
 *
 *  All three live in `training_settings`, the same free-form key/value store
 *  the launch date uses (`key text primary key`, no constraint on the key set),
 *  so adding them needs NO migration. Blank or missing falls back to the
 *  defaults below, which means clearing a field in admin restores the default
 *  rather than rendering an empty banner. */
export const LAUNCH_HEADLINE_KEY = 'modeling_hub_launch_headline';
export const LAUNCH_SUBLINE_KEY = 'modeling_hub_launch_subline';
/** The platform SLUG the launch belongs to. The NAME is never stored: it is
 *  resolved from the platform config at render time, so renaming a platform in
 *  one place updates the banner with it. */
export const LAUNCH_PLATFORM_KEY = 'modeling_hub_launch_platform';

/** Every key the banner reads, for a single batched settings query. */
export const LAUNCH_SETTING_KEYS: readonly string[] = [
  LAUNCH_DATE_KEY, LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY,
];

/** The token an admin can place in either copy field to get the platform name
 *  without typing it, mirroring the `{trialDays}` token in trialConfig. */
export const PLATFORM_TOKEN = '{platform}';

export const DEFAULT_LAUNCH_HEADLINE = `${PLATFORM_TOKEN} is launching soon`;
export const DEFAULT_LAUNCH_SUBLINE = `Institutional-grade modeling, ready on day one.`;

/** Replace every occurrence of the platform token. Falls back to leaving the
 *  text alone when no platform name resolved, rather than printing a literal
 *  "{platform}" at a visitor. */
export function applyPlatformToken(text: string, platformName: string): string {
  if (!text.includes(PLATFORM_TOKEN)) return text;
  if (!platformName) return text.split(PLATFORM_TOKEN).join('the platform').replace(/\s+/g, ' ').trim();
  return text.split(PLATFORM_TOKEN).join(platformName);
}

export interface LaunchCopy { headline: string; subline: string }

/**
 * The banner copy: admin text when set, defaults otherwise, with the platform
 * token resolved in BOTH cases. Pure, so the verifier can pin the fallbacks and
 * the substitution without a database or a render.
 */
export function resolveLaunchCopy(args: {
  headline?: string | null;
  subline?: string | null;
  platformName?: string | null;
}): LaunchCopy {
  const name = (args.platformName ?? '').trim();
  const rawHeadline = (args.headline ?? '').trim() || DEFAULT_LAUNCH_HEADLINE;
  const rawSubline = (args.subline ?? '').trim() || DEFAULT_LAUNCH_SUBLINE;
  return {
    headline: applyPlatformToken(rawHeadline, name),
    subline: applyPlatformToken(rawSubline, name),
  };
}

/**
 * The five routes the banner is allowed on, matched EXACTLY.
 *
 * An allowlist rather than the blocklist PromoPopup uses: this banner is
 * centred and covers content, so a path it was never meant for is a much worse
 * failure than a missed impression. Exact matching also keeps it off deeper
 * routes, so /modeling/business-valuation and /modeling/real-estate/anything
 * stay clear while /modeling/real-estate itself shows it.
 *
 * '/' covers two different pages by design: the apex marketing home, and the
 * app subdomain root, which next.config rewrites to /modeling while the browser
 * path stays '/'. Both are targets, so one entry serves both.
 */
export const LAUNCH_BANNER_PATHS: readonly string[] = [
  '/',
  '/modeling',
  '/modeling/real-estate',
  '/modeling-hub',
  '/modeling-hub/real-estate',
];

/** Exact path match, tolerant of a trailing slash and of a query/hash already
 *  stripped by the router. Never a prefix match: see LAUNCH_BANNER_PATHS. */
export function isLaunchBannerPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const clean = pathname.split('?')[0].split('#')[0];
  const normalized = clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
  return LAUNCH_BANNER_PATHS.includes(normalized);
}

/**
 * The dismissal key. Keyed on the launch DATE, so:
 *   - dismissing it stays dismissed for the session, and
 *   - moving the launch date makes it a new announcement that shows again,
 *     which is the behaviour an admin expects after changing the date.
 * Stored in sessionStorage (not localStorage), so a returning visitor in a new
 * session sees it again while the current session stays uninterrupted.
 */
export function launchDismissKey(targetIso: string): string {
  return `fmp_launch_countdown_dismissed:${targetIso}`;
}

export interface LaunchCountdownDecision {
  /** Whether to render at all. */
  show: boolean;
  /** The launch instant, normalized to ISO. Empty when there is nothing to show. */
  targetIso: string;
  /** Why it is hidden, for the verifier and for debugging. */
  reason: 'ok' | 'not_set' | 'invalid_date' | 'already_launched';
}

/**
 * Should the banner show, and for which instant?
 *
 * Hidden when the key is missing or blank (nothing announced), when the stored
 * value does not parse (a bad value must not render "Invalid Date" at a
 * visitor), and when the instant has passed (the launch happened). `nowMs` is
 * injected rather than read from the clock so the verifier can test both sides
 * of the boundary without waiting for real time to pass.
 */
export function resolveLaunchCountdown(args: {
  launchDate: string | null | undefined;
  nowMs: number;
}): LaunchCountdownDecision {
  const raw = (args.launchDate ?? '').trim();
  if (!raw) return { show: false, targetIso: '', reason: 'not_set' };

  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { show: false, targetIso: '', reason: 'invalid_date' };

  const targetIso = new Date(ms).toISOString();
  // Strictly greater: at the exact launch instant the hub is live, so the
  // countdown is over rather than showing a frozen zero.
  if (ms <= args.nowMs) return { show: false, targetIso, reason: 'already_launched' };

  return { show: true, targetIso, reason: 'ok' };
}
