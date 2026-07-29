/**
 * shared/utils/externalUrl.ts
 *
 * Pure helpers for user-supplied external links (LinkedIn profiles, video URLs).
 *
 * The problem this solves: people paste "www.linkedin.com/in/name" without a
 * scheme. A bare host in an href is a RELATIVE path, so the browser resolves it
 * against the current site and you get
 * https://learn.financialmodelerpro.com/www.linkedin.com/in/name. Normalizing
 * adds the missing scheme so the link leaves the site as intended.
 *
 * Used at BOTH ends: on submit (so stored data is clean going forward) and at
 * render (so rows already stored without a scheme still link correctly, with no
 * data migration).
 *
 * No em dashes in this file.
 */

/** Schemes that must never end up in an href we render. */
const DANGEROUS = /^(javascript|data|vbscript|file):/i;

/** Already carries an http(s) scheme. */
const HAS_HTTP = /^https?:\/\//i;

/** Any scheme at all, e.g. "mailto:", "ftp:". */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalize a user-entered external URL to something safe to put in an href.
 *
 * - Trims; empty / whitespace-only becomes null.
 * - Leaves an existing http(s) URL alone.
 * - "//host/path" (protocol-relative) becomes https://host/path.
 * - A bare "host/path" (contains a dot in the first segment) gains https://.
 * - Rejects javascript:/data:/vbscript:/file: outright (returns null).
 * - Returns null for anything else that cannot be made into an absolute URL
 *   (e.g. a plain handle like "raomkamran"), so callers render nothing rather
 *   than a link that silently points back at our own site.
 */
export function normalizeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Strip wrapping angle brackets / quotes people sometimes paste.
  const cleaned = s.replace(/^[<"']+/, '').replace(/[>"']+$/, '').trim();
  if (!cleaned) return null;

  if (DANGEROUS.test(cleaned)) return null;
  if (HAS_HTTP.test(cleaned)) return safeParse(cleaned);
  if (cleaned.startsWith('//')) return safeParse(`https:${cleaned}`);

  // Some other scheme (mailto:, ftp:, ...): not an external web link we render.
  if (HAS_SCHEME.test(cleaned)) return null;

  // Bare host or host/path: the first segment must look like a domain, so a
  // stray handle ("raomkamran") is not turned into https://raomkamran.
  const firstSegment = cleaned.split('/')[0];
  if (!firstSegment.includes('.')) return null;

  return safeParse(`https://${cleaned}`);
}

/** Final validation through the URL parser; returns null if it will not parse. */
function safeParse(candidate: string): string | null {
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Normalize specifically for a LinkedIn profile field. Same rules as
 * normalizeExternalUrl, plus: a bare profile path ("in/name", "/in/name") or a
 * plain handle typed on its own is resolved against linkedin.com, because that
 * field asks for a LinkedIn profile and nothing else.
 */
export function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^[<"']+/, '').replace(/[>"']+$/, '').trim();
  if (!s) return null;
  if (DANGEROUS.test(s)) return null;

  const direct = normalizeExternalUrl(s);
  if (direct) return direct;

  // "in/name" or "/in/name" -> a LinkedIn profile path.
  const path = s.replace(/^\/+/, '');
  if (/^in\/[^/\s]+/i.test(path)) return safeParse(`https://www.linkedin.com/${path}`);

  return null;
}
