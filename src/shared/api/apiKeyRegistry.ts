/**
 * apiKeyRegistry.ts
 *
 * WHICH secrets the admin API Keys screen may touch, and the admin guard both
 * of its routes use.
 *
 * ── THE ONE RULE THAT MATTERS ──────────────────────────────────────────────
 *
 * THE CLIENT NEVER NAMES AN ENVIRONMENT VARIABLE. Both routes take an `id` and
 * look it up in the REGISTRY below; neither reads `process.env[whatever the
 * browser sent]`. That is the whole difference between an API keys screen and
 * an arbitrary environment reader that would hand out SUPABASE_SERVICE_ROLE_KEY,
 * NEXTAUTH_SECRET and ANTHROPIC_API_KEY to anyone who could reach it. Adding a
 * key here is a deliberate, reviewable edit to one constant.
 *
 * It lives here rather than in the route file because there are now TWO routes
 * (read and rotate) and a route.ts may not export anything but its handlers and
 * the framework's config fields. Two copies of a security registry is the last
 * thing this should have.
 *
 * No em dashes in this file.
 */

import { NextResponse } from 'next/server';
import { getServerSession, type Session } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  PUBLIC_PAGE_SLUGS, PUBLIC_PAGES_PATH, PUBLIC_API_KEY_GRANTS, PUBLIC_API_KEY_CAVEAT,
} from '@/src/shared/api/publicPagesConfig';
import { PUBLIC_PAGES_KEY_ID } from '@/src/shared/api/publicApiKeys';

/** A secret an admin is allowed to read or rotate through this screen. */
export interface KeyEntry {
  /** Stable id the client sends. Never an env var name. */
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
  /**
   * Key id in `public_api_keys` when this secret can be rotated from here.
   * Absent means it lives only in the environment and no rotate button appears.
   */
  storeKeyId?: string;
  /** Resolved from the server environment. A function, so the value is read at
   *  request time and never captured into a module-level constant. */
  read: () => string | undefined;
}

export const REGISTRY: readonly KeyEntry[] = [
  {
    id: PUBLIC_PAGES_KEY_ID,
    label: 'Public page feed key',
    envVar: 'FMP_PUBLIC_API_KEY',
    consumer: 'PaceMakers Business Consultants, to render FMP page content on the partner site.',
    endpointPath: PUBLIC_PAGES_PATH,
    transport: 'Sent as the x-api-key request header.',
    grants: PUBLIC_API_KEY_GRANTS,
    caveat: PUBLIC_API_KEY_CAVEAT,
    slugs: PUBLIC_PAGE_SLUGS,
    storeKeyId: PUBLIC_PAGES_KEY_ID,
    read: () => process.env.FMP_PUBLIC_API_KEY,
  },
];

export function findKeyEntry(id: string): KeyEntry | undefined {
  return REGISTRY.find((k) => k.id === id);
}

export const noStore = { 'Cache-Control': 'no-store' } as const;

export type AdminAuth =
  | { ok: true; userId: string; email: string }
  | { ok: false; res: NextResponse };

/**
 * Admin session or nothing. Returns the session user on success.
 *
 * A session that cannot be READ is not a session. `getServerSession` throws
 * rather than returning null when there is no request scope, and letting that
 * escape would turn a missing session into a 500 with a stack trace instead of
 * a clean 401. Failing closed on the throw is both the safer answer and the
 * honest one.
 */
export async function requireAdmin(): Promise<AdminAuth> {
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
