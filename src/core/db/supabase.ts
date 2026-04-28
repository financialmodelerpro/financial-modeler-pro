/**
 * supabase.ts - Supabase client instances (lazy)
 *
 * serverClient  → uses SERVICE_ROLE_KEY (bypasses RLS) - API routes only
 * browserClient → uses ANON_KEY (respects RLS) - safe for frontend
 *
 * Clients are created lazily so a missing .env.local does not crash the
 * module at import time - errors surface only when a client is actually used.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Server client (API routes only) ──────────────────────────────────────────
let _serverClient: SupabaseClient | null = null;

export function getServerClient(): SupabaseClient {
  if (_serverClient) return _serverClient;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url) throw new Error('Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  if (!key) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');

  _serverClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serverClient;
}

// Convenience proxy - same API as the old `serverClient` export
export const serverClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getServerClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ── Browser client (frontend) ─────────────────────────────────────────────────
let _browserClient: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY');

  _browserClient = createClient(url, key);
  return _browserClient;
}

export const browserClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getBrowserClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Legacy default export
export const supabase = browserClient;
