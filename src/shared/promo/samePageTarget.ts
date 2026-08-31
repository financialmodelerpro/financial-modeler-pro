/**
 * samePageTarget.ts (pure: no React, no next imports, no I/O)
 *
 * ONE RULE, for every promo that carries a call to action:
 *
 *     a promo never links to the page you are already on.
 *
 * WHY THIS IS A SHARED RULE AND NOT A PATH IN A LIST (2026-08-31). The launch
 * popup is allowed on five exact paths, one of which is `/modeling/real-estate`,
 * and its call to action defaults to the launch platform's OWN page, which for
 * the real-estate launch is `/modeling/real-estate`. So on that page it
 * announced the platform to somebody already standing on it and offered a
 * button back to where they were.
 *
 * The pricing promo had the same collision and avoided it by coincidence:
 * `/pricing` happens to sit in its hide-list for an unrelated reason (the plan
 * cards already show the offer). Two popups, one class of defect, one of them
 * guarded by a hand-kept list that names the destination nowhere. Changing
 * either destination would have re-opened it silently.
 *
 * So the destination decides, not a list. Both popups ask this function.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not guess. When it cannot tell (no
 * href, no path, an unparseable href, a different origin) it returns false, and
 * false means "show the promo". A missed suppression is a promo that points at
 * the current page; a wrong suppression is a promo nobody ever sees. The first
 * is visible and reported, the second is silent.
 *
 * No em dashes in this file.
 */

/** Strip query and hash, then a single trailing slash. '/' stays '/'. */
function normalizePath(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean || '/';
}

/** The origin and path of an href that may be absolute, protocol-relative or
 *  a bare path. Returns null when it is not a page link at all (mailto:, tel:,
 *  a fragment on the current page, javascript:). */
export function splitHref(href: string): { origin: string | null; path: string } | null {
  const raw = href.trim();
  if (!raw) return null;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return null;
  // A bare fragment or query targets the CURRENT page by definition, but it is
  // not a navigation, so it is not this rule's business.
  if (raw.startsWith('#') || raw.startsWith('?')) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
    try {
      const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      return { origin: `${u.protocol}//${u.host}`, path: normalizePath(u.pathname) };
    } catch {
      return null;
    }
  }
  if (!raw.startsWith('/')) return null; // a relative path with no leading slash: not resolvable here
  return { origin: null, path: normalizePath(raw) };
}

export interface SamePageArgs {
  /** The path the visitor is on, from the router. */
  pathname: string | null | undefined;
  /** The promo's call-to-action destination, absolute or a path. */
  href: string | null | undefined;
  /** `window.location.origin` when it is known. Absent during a server render;
   *  callers decide visibility in an effect, so it is known by then. */
  origin?: string | null;
  /**
   * Paths that render the SAME page as each other, SCOPED TO AN ORIGIN.
   *
   * Exists for one real case, passed in rather than hardcoded so no routing
   * rule lives in here: on the app subdomain `next.config` rewrites `/` to
   * `/modeling` while the browser path stays `/`. A promo pointing at
   * `/modeling` viewed at the app root is pointing at the current page, and a
   * path comparison alone cannot see it.
   *
   * THE ORIGIN IS PART OF THE GROUP because the equivalence is not universal:
   * on the APEX marketing domain `/` is the marketing home and is not
   * `/modeling` at all. An unscoped group would suppress a promo on the apex
   * home whenever its href was the relative path `/modeling`. A group with no
   * origin applies everywhere, which is only safe for a genuinely global
   * equivalence.
   */
  equivalentPaths?: readonly { origin?: string; paths: readonly string[] }[];
}

/**
 * True when the promo's destination IS the page currently being viewed.
 *
 * Origin is compared only when both sides state one: a relative href inherits
 * the current origin by definition, and an absolute href on a DIFFERENT origin
 * is a different page however similar the path looks (the apex marketing site
 * and the app subdomain both serve a real-estate path).
 */
export function isSamePageTarget(args: SamePageArgs): boolean {
  if (!args.pathname || !args.href) return false;
  const target = splitHref(args.href);
  if (!target) return false;

  const here = normalizePath(args.pathname);
  const origin = (args.origin ?? '').trim();
  if (target.origin && origin && target.origin.toLowerCase() !== origin.toLowerCase()) return false;

  if (target.path === here) return true;

  for (const group of args.equivalentPaths ?? []) {
    // A group that names an origin applies only on that origin.
    if (group.origin && group.origin.toLowerCase() !== origin.toLowerCase()) continue;
    const norm = group.paths.map(normalizePath);
    if (norm.includes(here) && norm.includes(target.path)) return true;
  }
  return false;
}

/**
 * The app subdomain's root rewrite, as an origin-scoped equivalence group.
 *
 * Stated once so neither popup repeats a routing fact that belongs to
 * `next.config.ts`. The caller supplies the app origin, because this module
 * holds no URLs.
 */
export function appRootEquivalence(appOrigin: string): readonly { origin?: string; paths: readonly string[] }[] {
  const o = (appOrigin ?? '').trim();
  return o ? [{ origin: o, paths: ['/', '/modeling'] }] : [];
}
