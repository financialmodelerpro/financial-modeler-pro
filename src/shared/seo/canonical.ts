const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL   ?? 'https://app.financialmodelerpro.com';

/**
 * Build a canonical URL for a given path. Defaults to the main domain, but
 * callers can pick the subdomain (`main` | `learn` | `app`) to match where
 * the route is actually served — this matters for duplicate-content
 * avoidance since all three subdomains come from the same Next.js app.
 */
export function canonicalUrl(path: string, domain: 'main' | 'learn' | 'app' = 'main'): string {
  const base = domain === 'learn' ? LEARN_URL : domain === 'app' ? APP_URL : MAIN_URL;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  // Strip trailing slash (except root) — consistent canonical form.
  const cleaned = normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  return `${base}${cleaned}`;
}

export const SEO_URLS = { MAIN_URL, LEARN_URL, APP_URL } as const;
