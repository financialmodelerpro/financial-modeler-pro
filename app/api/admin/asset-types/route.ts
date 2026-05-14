import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

// Pass 46 (2026-05-14): GET is now PUBLIC. By default returns only
// `visible = true` rows so the marketing site can render the REFM
// asset class grid. Admins pass `?includeHidden=1` to get the full
// list (with the visibility flag) for the toggle UI.
export async function GET(req: NextRequest) {
  try {
    const includeHidden = new URL(req.url).searchParams.get('includeHidden') === '1';
    const isAdmin = includeHidden ? await checkAdmin() : false;
    const sb = getServerClient();
    const query = sb.from('asset_types').select('*').order('display_order');
    const { data } = includeHidden && isAdmin ? await query : await query.eq('visible', true);
    return NextResponse.json({ assetTypes: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch asset types' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, visible } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const sb = getServerClient();
    const { error } = await sb.from('asset_types').update({ visible }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update asset type' }, { status: 500 });
  }
}
