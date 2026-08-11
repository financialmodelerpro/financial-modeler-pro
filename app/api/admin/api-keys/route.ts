import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, type Session } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { serverClient } from '@/src/core/db/supabase';
import {
  PUBLIC_PAGE_SLUGS, PUBLIC_PAGES_PATH, PUBLIC_API_KEY_GRANTS, PUBLIC_API_KEY_CAVEAT,
} from '@/src/shared/api/publicPagesConfig';

export const dynamic = 'force-dynamic';

/**
 * /api/admin/api-keys
 *
 * Lets an admin see and copy the shared secrets the platform hands to partners,
 * without opening the Vercel dashboard or a local env file.
 *
 * ── THE ONE RULE THAT MATTERS ──────────────────────────────────────────────
 *
 * THE CLIENT NEVER NAMES AN ENVIRONMENT VARIABLE. The reveal endpoint takes an
 * `id` and looks it up in the REGISTRY below; it does not read
 * `process.env[whatever the browser sent]`. That is the whole difference
 * between an API keys screen and an arbitrary environment reader that would
 * hand out SUPABASE_SERVICE_ROLE_KEY, NEXTAUTH_SECRET and ANTHROPIC_API_KEY to
 * anyone who could reach it. Adding a key here is a deliberate, reviewable edit
 * to one constant.
 *
 * ── WHAT EACH METHOD RETURNS ───────────────────────────────────────────────
 *
 * GET  metadata only: whether the key is configured, how many characters it is,
 *      what it grants, where the endpoint lives. NO PART of the value, not even
 *      a last-four suffix, because the brief was that the value reaches the
 *      client only on an explicit reveal and a suffix is still the value.
 *
 * POST the value, once, for a named registry entry, AND an audit row. Copying
 *      is a read, so the copy button goes through this same path rather than a
 *      quieter one: there is no way to get the secret out of here without
 *      leaving a record.
 *
 * Both responses are no-store. A secret must not sit in a CDN or a browser
 * cache, and `force-dynamic` keeps the route off the prerender path.
 *
 * No em dashes in this file.
 */

/** A secret an admin is allowed to read through this screen. */
interface KeyEntry {
  /** Stable id the client sends on reveal. Never an env var name. */
  id: string;
  label: string;
  /** Named for display only. It is NOT how the value is resolved. */
  envVar: string;
  /** Who or what consumes this key. */
  consumer: string;
  endpointPath: string;
  /** How the caller presents it. */
  transport: string;
  grants: readonly string[];
  caveat?: string;
  slugs?: readonly string[];
  /** Resolved from the server environment. A function, so the value is read at
   *  request time and never captured into a module-level constant. */
  read: () => string | undefined;
}

const REGISTRY: readonly KeyEntry[] = [
  {
    id: 'fmp-public-pages',
    label: 'Public page feed key',
    envVar: 'FMP_PUBLIC_API_KEY',
    consumer: 'PaceMakers Business Consultants, to render FMP page content on the partner site.',
    endpointPath: PUBLIC_PAGES_PATH,
    transport: 'Sent as the x-api-key request header.',
    grants: PUBLIC_API_KEY_GRANTS,
    caveat: PUBLIC_API_KEY_CAVEAT,
    slugs: PUBLIC_PAGE_SLUGS,
    read: () => process.env.FMP_PUBLIC_API_KEY,
  },
];

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Admin session or nothing. Returns the session user on success.
 *
 * A session that cannot be READ is not a session. `getServerSession` throws
 * rather than returning null when there is no request scope, and letting that
 * escape would turn a missing session into a 500 with a stack trace instead of
 * a clean 401. Failing closed on the throw is both the safer answer and the
 * honest one.
 */
async function requireAdmin(): Promise<
  { ok: true; userId: string; email: string } | { ok: false; res: NextResponse }
> {
  let session: Session | null = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore }) };
  }
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore }) };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, res: NextResponse.json({ error: 'Admin only' }, { status: 403, headers: noStore }) };
  }
  const u = session.user as { id?: string; email?: string | null };
  return { ok: true, userId: u.id ?? '', email: u.email ?? '' };
}

/**
 * GET: every registered key, described but not disclosed.
 *
 * `configured` is the field the UI needs most: an unset variable must read as
 * "not configured", naming the variable, rather than as an empty box that looks
 * like a key of length zero.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  const keys = REGISTRY.map((k) => {
    const value = k.read();
    const configured = typeof value === 'string' && value.length > 0;
    return {
      id: k.id,
      label: k.label,
      envVar: k.envVar,
      consumer: k.consumer,
      endpointPath: k.endpointPath,
      transport: k.transport,
      grants: k.grants,
      caveat: k.caveat ?? null,
      slugs: k.slugs ?? [],
      configured,
      // Length only. Enough for an admin to sanity check that the deployed
      // value looks like the key they set, and not a fragment of it.
      length: configured ? value!.length : 0,
      failsClosed: true,
    };
  });

  return NextResponse.json({ keys }, { headers: noStore });
}

/**
 * POST: reveal one key by registry id, and record that it happened.
 *
 * The audit write is BEST EFFORT and deliberately cannot fail the request: a
 * logging outage should not lock an admin out of their own key. It is logged
 * loudly instead, so a silent gap in the trail is visible in the server logs.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  let body: { id?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body is a bad request below */ }
  const id = typeof body.id === 'string' ? body.id : '';

  const entry = REGISTRY.find((k) => k.id === id);
  if (!entry) {
    return NextResponse.json({ error: 'unknown_key' }, { status: 404, headers: noStore });
  }

  const value = entry.read();
  if (!value) {
    return NextResponse.json(
      { error: 'not_configured', envVar: entry.envVar },
      { status: 409, headers: noStore },
    );
  }

  try {
    const { error } = await serverClient.from('admin_audit_log').insert({
      admin_id: auth.userId || null,
      action: 'api_key_revealed',
      after_value: { keyId: entry.id, envVar: entry.envVar, by: auth.email },
      reason: 'Viewed or copied in Admin > API Keys',
    });
    if (error) console.warn('[api-keys] audit insert failed:', error.message);
  } catch (e) {
    console.warn('[api-keys] audit insert threw:', (e as Error).message);
  }

  return NextResponse.json({ id: entry.id, value }, { headers: noStore });
}
