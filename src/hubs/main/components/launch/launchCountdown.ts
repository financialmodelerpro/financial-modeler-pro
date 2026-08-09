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

/** The master switch. ABSENT MEANS ON: only the literal string 'false' turns
 *  the banner off, so an install that predates this key behaves exactly as it
 *  did. It exists so retiring the banner is its own action, rather than being
 *  done by clearing the launch date, which is the key the auto-launch cron
 *  reads and must not be collateral damage. */
export const LAUNCH_BANNER_ENABLED_KEY = 'modeling_hub_launch_banner_enabled';

/** Post-launch copy. Separate keys from the countdown copy, not a reuse: the
 *  two say different things and an admin should be able to write the launch
 *  announcement in advance without disturbing the countdown that is live. */
export const LAUNCHED_HEADLINE_KEY = 'modeling_hub_launched_headline';
export const LAUNCHED_SUBLINE_KEY = 'modeling_hub_launched_subline';
export const LAUNCHED_CTA_LABEL_KEY = 'modeling_hub_launched_cta_label';
/** Optional href override. Blank means "the platform's own page", derived from
 *  the platform slug at render, so the common case needs no configuration and
 *  no URL is hardcoded in the banner. */
export const LAUNCHED_CTA_HREF_KEY = 'modeling_hub_launched_cta_href';

/** Every key the banner reads, for a single batched settings query. */
export const LAUNCH_SETTING_KEYS: readonly string[] = [
  LAUNCH_DATE_KEY, LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY,
  LAUNCH_BANNER_ENABLED_KEY,
  LAUNCHED_HEADLINE_KEY, LAUNCHED_SUBLINE_KEY, LAUNCHED_CTA_LABEL_KEY, LAUNCHED_CTA_HREF_KEY,
];

/** The token an admin can place in either copy field to get the platform name
 *  without typing it, mirroring the `{trialDays}` token in trialConfig. */
export const PLATFORM_TOKEN = '{platform}';

export const DEFAULT_LAUNCH_HEADLINE = `${PLATFORM_TOKEN} is launching soon`;
export const DEFAULT_LAUNCH_SUBLINE = `Institutional-grade modeling, ready on day one.`;

export const DEFAULT_LAUNCHED_HEADLINE = `${PLATFORM_TOKEN} is live`;
export const DEFAULT_LAUNCHED_SUBLINE = `The platform is open. Start building your first model today.`;
export const DEFAULT_LAUNCHED_CTA_LABEL = `Explore ${PLATFORM_TOKEN}`;

/** Replace every occurrence of the platform token. Falls back to leaving the
 *  text alone when no platform name resolved, rather than printing a literal
 *  "{platform}" at a visitor. */
export function applyPlatformToken(text: string, platformName: string): string {
  if (!text.includes(PLATFORM_TOKEN)) return text;
  if (!platformName) return text.split(PLATFORM_TOKEN).join('the platform').replace(/\s+/g, ' ').trim();
  return text.split(PLATFORM_TOKEN).join(platformName);
}

export interface LaunchCopy { headline: string; subline: string }
export interface LaunchedCopy extends LaunchCopy { ctaLabel: string; ctaHref: string }

/**
 * The post-launch copy, including the call to action.
 *
 * `platformHref` is the DERIVED destination (the platform's own page, built
 * from its slug by the caller that owns the URL rules), used whenever the admin
 * has not typed an override. The banner therefore links somewhere sensible with
 * zero configuration, and no URL literal lives in the component.
 */
export function resolveLaunchedCopy(args: {
  headline?: string | null;
  subline?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  platformName?: string | null;
  platformHref?: string | null;
}): LaunchedCopy {
  const name = (args.platformName ?? '').trim();
  const base = resolveLaunchCopy({
    headline: (args.headline ?? '').trim() || DEFAULT_LAUNCHED_HEADLINE,
    subline: (args.subline ?? '').trim() || DEFAULT_LAUNCHED_SUBLINE,
    platformName: name,
  });
  const label = (args.ctaLabel ?? '').trim() || DEFAULT_LAUNCHED_CTA_LABEL;
  return {
    ...base,
    ctaLabel: applyPlatformToken(label, name),
    ctaHref: (args.ctaHref ?? '').trim() || (args.platformHref ?? '').trim(),
  };
}

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
 * The dismissal key. Keyed on the launch DATE **and the MODE**, so:
 *   - dismissing it stays dismissed for the session,
 *   - moving the launch date makes it a new announcement that shows again, and
 *   - dismissing the COUNTDOWN does not also swallow the LAUNCHED message.
 *
 * That last one is why the mode is in the key. The date does not change when
 * the launch happens, so a single date-keyed entry would let a visitor who
 * closed the countdown in the morning miss the launch announcement the same
 * afternoon. Two announcements, two memories.
 *
 * sessionStorage (not localStorage), so a returning visitor in a new session
 * sees it again while the current session stays uninterrupted.
 */
export function launchDismissKey(targetIso: string, mode: LaunchMode = 'countdown'): string {
  return `fmp_launch_countdown_dismissed:${mode}:${targetIso}`;
}

/** What the banner is currently saying. `hidden` renders nothing at all. */
export type LaunchMode = 'countdown' | 'launched' | 'hidden';

export interface LaunchDecision {
  /** `countdown` before the date, `launched` after it, `hidden` otherwise. */
  mode: LaunchMode;
  /** The launch instant, normalized to ISO. Empty when there is nothing to show. */
  targetIso: string;
  /** Why the banner is in this mode, for the admin readout and the verifier. */
  reason: 'ok_countdown' | 'ok_launched' | 'not_set' | 'invalid_date' | 'turned_off';
}

/**
 * Which of the three states the banner is in.
 *
 * THREE STATES, and only one of them is an admin decision:
 *
 *   counting down   the date is in the future
 *   launched        the date has passed, and the banner now ANNOUNCES the
 *                   launch instead of vanishing. It stays until switched off,
 *                   so retiring it is a choice rather than a timeout.
 *   off             the admin switched it off, or there is nothing to say
 *                   (no date, or a date that will not parse)
 *
 * Countdown and launched are derived purely from the date, never stored, so the
 * two can never disagree with the clock. `bannerEnabled` is the only stored
 * switch, and it is checked FIRST so turning it off is absolute.
 *
 * Turning it off is a real need rather than a nicety: the alternative was
 * clearing the launch date, and that same key drives the auto-launch cron, so
 * hiding the banner that way would blank the hub's launch trigger.
 *
 * `nowMs` is injected rather than read from the clock so the verifier can test
 * both sides of the boundary without waiting for real time to pass.
 */
export function resolveLaunchState(args: {
  launchDate: string | null | undefined;
  nowMs: number;
  /** Absent or true means ON. Only an explicit false switches the banner off,
   *  so an existing install with no such setting keeps behaving as it did. */
  bannerEnabled?: boolean;
}): LaunchDecision {
  if (args.bannerEnabled === false) return { mode: 'hidden', targetIso: '', reason: 'turned_off' };

  const raw = (args.launchDate ?? '').trim();
  if (!raw) return { mode: 'hidden', targetIso: '', reason: 'not_set' };

  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { mode: 'hidden', targetIso: '', reason: 'invalid_date' };

  const targetIso = new Date(ms).toISOString();
  // At the exact instant the launch has happened, so the banner is already
  // announcing rather than showing a frozen zero.
  if (ms <= args.nowMs) return { mode: 'launched', targetIso, reason: 'ok_launched' };

  return { mode: 'countdown', targetIso, reason: 'ok_countdown' };
}
