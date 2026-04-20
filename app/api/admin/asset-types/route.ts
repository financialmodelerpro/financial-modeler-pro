import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sb = getServerClient();
    const { data } = await sb.from('asset_types').select('*').order('display_order');
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
