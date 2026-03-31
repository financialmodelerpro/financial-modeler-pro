import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { serverClient } from '@/src/lib/supabase';
import type { BrandingConfig } from '@/src/types/branding.types';

/**
 * GET /api/branding?scope=<userId|global>
 * Returns the branding config for a given scope (admin only).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const scope = req.nextUrl.searchParams.get('scope') ?? 'global';

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ config: null });
  }

  const { data } = await serverClient
    .from('branding_config')
    .select('config')
    .eq('scope', scope)
    .maybeSingle();

  return NextResponse.json({ config: data?.config ?? null });
}

/**
 * PATCH /api/branding
 * Persists branding config to Supabase.
 * Admins can write to any scope (global or per-user).
 * Non-admins: white-label fields are enterprise-only.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const body   = (await req.json()) as { config: BrandingConfig; scope?: string };
  const config = body.config ?? (body as unknown as BrandingConfig); // backwards compat
  const scope  = body.scope ?? 'global';

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // No Supabase configured — silently accept (localStorage-only mode)
    return NextResponse.json({ ok: true });
  }

  // Read the existing config first, then merge — never wipe fields that aren't in the incoming payload
  let existingConfig: Record<string, unknown> = {};
  try {
    const { data: existing } = await serverClient
      .from('branding_config')
      .select('config')
      .eq('scope', scope)
      .maybeSingle();
    if (existing?.config && typeof existing.config === 'object') {
      existingConfig = existing.config as Record<string, unknown>;
    }
  } catch {
    // Non-fatal — proceed with empty existing config
  }

  const mergedConfig = { ...existingConfig, ...(config as Record<string, unknown>) };

  let upsertError: { message: string } | null = null;
  try {
    const { error } = await serverClient
      .from('branding_config')
      .upsert({ scope, config: mergedConfig }, { onConflict: 'scope' });
    upsertError = error;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
