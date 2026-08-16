import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { rateLimited } from '@/src/shared/api/rateLimit';
import { SLUG_WHITELIST } from '@/src/shared/api/publicPagesConfig';
import { verifyApiKey, PUBLIC_PAGES_KEY_ID } from '@/src/shared/api/publicApiKeys';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/pages/[slug]
 *
 * Read-only public feed of selected CMS pages, so PaceMakers Business
 * Consultants can render FMP page content inside its own site without a
 * database connection or a shared deploy.
 *
 * Returns the page metadata plus its VISIBLE sections in display order, and
 * nothing else. Internal columns (row ids, is_system, created_at, the visible
 * flag itself) are deliberately not in the response: a consumer that cannot see
 * them cannot come to depend on them.
 *
 * ── THE PUBLIC SLUG IS NOT THE INTERNAL SLUG ───────────────────────────────
 *
 * The three slugs this endpoint exposes are a STABLE PUBLIC VOCABULARY chosen
 * for the consumer, mapped here onto whatever the CMS happens to call the page
 * today. They did not match: the live `cms_pages` rows are `modeling`,
 * `modeling-real-estate` and `training`, so a literal whitelist would have
 * 404ed on all three. Mapping in one constant means the CMS can rename a page,
 * or the marketing site can restructure, without breaking a partner's site.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * No write methods. No listing endpoint (a consumer must know the slug). No
 * draft access, so unpublished work cannot leak through a partner's site.
 *
 * No em dashes in this file.
 */

// SLUG_WHITELIST moved to src/shared/api/publicPagesConfig.ts on 2026-08-11.
// The admin API Keys view has to list the same slugs this route serves, and two
// copies would drift the first time a page is opted in. Behaviour here is
// unchanged; the constant simply has one home now.

/** Requests per IP per window, and the window. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/** Caller IP, best effort, from the proxy headers Vercel sets. */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// The key comparison moved to src/shared/api/publicApiKeys.ts on 2026-08-16,
// when the key became rotatable from the admin. It is still a constant-time
// compare; what changed is that the value it compares against now resolves from
// the rotation table first and the environment variable only as a fallback, and
// the admin screen resolves through the same function so it cannot describe a
// key the endpoint would refuse.

/**
 * Record a rejected call. Best effort and NEVER throws into the response: an
 * audit table that is missing or slow must not turn a 401 into a 500.
 *
 * Writes to `public_api_audit` (migration 212). It is a dedicated table rather
 * than `admin_audit_log` because that one requires a NOT NULL `admin_id` (a
 * live probe confirms the constraint) and an unauthenticated caller has no
 * admin to attribute the row to.
 */
async function auditUnauthorized(slug: string, ip: string, reason: string): Promise<void> {
  try {
    const sb = getServerClient();
    const { error } = await sb.from('public_api_audit').insert({
      action: 'public_api_unauthorized',
      metadata: { slug, ip, reason },
    });
    if (error) console.warn('[public-api] audit write failed:', error.message);
  } catch (e) {
    console.warn('[public-api] audit write threw:', (e as Error).message);
  }
}

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ip = clientIp(req);

  // 1. Rate limit FIRST, so a flood of bad keys cannot also flood the audit
  //    table. The limit applies to every caller, authenticated or not.
  if (rateLimited('public-pages', ip, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'rate_limited', message: `Too many requests. Limit is ${RATE_LIMIT} per minute.` },
      { status: 429, headers: { ...noStore, 'Retry-After': '60' } },
    );
  }

  // 2. Authenticate against whatever is live: the active rotation row if one
  //    exists, the environment variable only while none ever has. Resolution
  //    lives in the shared module so the admin screen and this route cannot
  //    disagree about which key works. It still fails CLOSED: no key of either
  //    kind, an unreadable key store, or a retired-only history all refuse
  //    every caller rather than opening the endpoint.
  const provided = req.headers.get('x-api-key') ?? '';
  const auth = await verifyApiKey(getServerClient(), PUBLIC_PAGES_KEY_ID, provided);
  if (!auth.ok) {
    if (auth.reason === 'not_configured') {
      console.error('[public-api] no key is configured (no active row and FMP_PUBLIC_API_KEY unset); refusing all requests.');
    } else if (auth.reason === 'all_keys_retired') {
      console.error('[public-api] every key has been retired and none issued; refusing all requests.');
    } else if (auth.reason === 'key_store_unreadable') {
      // Unreadable is NOT empty. Falling back to the environment here would
      // resurrect a key that a rotation deliberately retired.
      console.error('[public-api] the key store could not be read; refusing rather than falling back.');
    }
    // Only a CALLER's failure is audited. A server that has no usable key would
    // otherwise write one row per request for every caller at once, which
    // floods the audit table with rows about our own misconfiguration; the
    // console error above is the right channel for that.
    if (auth.reason === 'missing_key' || auth.reason === 'wrong_key') {
      await auditUnauthorized(slug, ip, auth.reason);
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }

  // 3. Whitelist. A slug that is not opted in does not exist as far as this
  //    endpoint is concerned, so it 404s rather than 403s.
  const internalSlug = SLUG_WHITELIST[slug];
  if (!internalSlug) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });
  }

  try {
    const sb = getServerClient();
    const { data: page, error: pageErr } = await sb
      .from('cms_pages')
      .select('slug, title, seo_title, seo_description, status, updated_at')
      .eq('slug', internalSlug)
      .maybeSingle();

    // Drafts and missing pages are indistinguishable from the outside, which is
    // the point: a partner must not be able to probe for unpublished work.
    if (pageErr || !page || page.status !== 'published') {
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });
    }

    const { data: sections, error: secErr } = await sb
      .from('page_sections')
      .select('section_type, content, styles, display_order')
      .eq('page_slug', internalSlug)
      .eq('visible', true)
      .order('display_order', { ascending: true });

    if (secErr) {
      console.error('[public-api] section query failed:', secErr.message);
      return NextResponse.json({ error: 'server_error' }, { status: 500, headers: noStore });
    }

    return NextResponse.json(
      {
        version: 1,
        page: {
          // The PUBLIC slug is echoed, not the internal one, so a consumer
          // never learns or hard-codes the CMS naming.
          slug,
          title: page.title ?? '',
          // `cms_pages` stores these as seo_*; the public contract names them
          // meta_* because that is what a consumer renders them into.
          meta_title: page.seo_title ?? '',
          meta_description: page.seo_description ?? '',
          // No per-page OG image exists in the schema. The field is present so
          // the contract is stable if a column is added later, and null rather
          // than a fabricated fallback.
          og_image_url: null,
          status: page.status,
          updated_at: page.updated_at,
        },
        sections: (sections ?? []).map((s) => ({
          section_type: s.section_type,
          content: s.content ?? {},
          styles: s.styles ?? {},
          display_order: s.display_order,
        })),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' },
      },
    );
  } catch (e) {
    console.error('[public-api] unexpected failure:', (e as Error).message);
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: noStore });
  }
}
