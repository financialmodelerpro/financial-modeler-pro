import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('training_settings').select('value').eq('key', 'modeling_hub_coming_soon').single();
    return NextResponse.json({ enabled: data?.value === 'true' });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { enabled } = await req.json() as { enabled: boolean };
    const sb = getServerClient();
    const { error } = await sb
      .from('training_settings')
      .upsert({ key: 'modeling_hub_coming_soon', value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, enabled });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
