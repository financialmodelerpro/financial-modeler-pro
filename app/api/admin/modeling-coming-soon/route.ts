import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', ['modeling_hub_coming_soon', 'modeling_hub_launch_date']);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    return NextResponse.json({
      enabled: map.get('modeling_hub_coming_soon') === 'true',
      launchDate: map.get('modeling_hub_launch_date') ?? '',
    });
  } catch {
    return NextResponse.json({ enabled: false, launchDate: '' });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json() as { enabled?: boolean; launchDate?: string };
    const sb = getServerClient();
    const rows: Array<{ key: string; value: string }> = [];
    if (typeof body.enabled === 'boolean') {
      rows.push({ key: 'modeling_hub_coming_soon', value: body.enabled ? 'true' : 'false' });
    }
    if (typeof body.launchDate === 'string') {
      rows.push({ key: 'modeling_hub_launch_date', value: body.launchDate.trim() });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    const { error } = await sb
      .from('training_settings')
      .upsert(rows, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', ['modeling_hub_coming_soon', 'modeling_hub_launch_date']);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    return NextResponse.json({
      ok: true,
      enabled: map.get('modeling_hub_coming_soon') === 'true',
      launchDate: map.get('modeling_hub_launch_date') ?? '',
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
