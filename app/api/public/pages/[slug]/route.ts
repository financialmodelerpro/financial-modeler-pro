import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getServerClient } from '@/src/core/db/supabase';
import { rateLimited } from '@/src/shared/api/rateLimit';

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

/**
 * The only slugs this endpoint will serve, mapped to their CMS page slug.
 * Anything not in this object is a 404, including a real CMS page that simply
 * has not been opted in. Adding a page to the public feed is a deliberate,
 * reviewable edit to this constant.
 */
const SLUG_WHITELIST: Readonly<Record<string, string>> = {
  'modeling-hub': 'modeling',
  'refm': 'modeling-real-estate',
  'training-hub': 'training',
};

/** Requests per IP per window, and the window. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/** Caller IP, best effort, from the proxy headers Vercel sets. */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Constant-time key comparison, so a wrong key cannot be discovered by timing. */
function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the length itself is not
  // a secret worth protecting here, so the guard is fine.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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

  // 2. Authenticate.
  const expected = process.env.FMP_PUBLIC_API_KEY ?? '';
  const provided = req.headers.get('x-api-key') ?? '';
  if (!expected) {
    // Fail CLOSED. An unset key must not mean an open endpoint.
    console.error('[public-api] FMP_PUBLIC_API_KEY is not set; refusing all requests.');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }
  if (!provided || !keyMatches(provided, expected)) {
    await auditUnauthorized(slug, ip, provided ? 'wrong_key' : 'missing_key');
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
