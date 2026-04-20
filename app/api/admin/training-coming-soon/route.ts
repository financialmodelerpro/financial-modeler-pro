import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

const KEYS = [
  'training_hub_coming_soon',
  'training_hub_launch_date',
  'training_hub_auto_launch',
  'training_hub_last_auto_launched_at',
] as const;

type KeyMap = Map<string, string>;

async function readAll(): Promise<KeyMap> {
  const sb = getServerClient();
  const { data } = await sb
    .from('training_settings')
    .select('key,value')
    .in('key', KEYS as unknown as string[]);
  return new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

function toResponse(map: KeyMap) {
  return {
    enabled:            map.get('training_hub_coming_soon') === 'true',
    launchDate:         map.get('training_hub_launch_date') ?? '',
    autoLaunch:         map.get('training_hub_auto_launch') === 'true',
    lastAutoLaunchedAt: map.get('training_hub_last_auto_launched_at') ?? '',
  };
}

export async function GET() {
  try {
    return NextResponse.json(toResponse(await readAll()));
  } catch {
    return NextResponse.json({ enabled: false, launchDate: '', autoLaunch: false, lastAutoLaunchedAt: '' });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json() as { enabled?: boolean; launchDate?: string; autoLaunch?: boolean };
    const sb = getServerClient();
    const rows: Array<{ key: string; value: string }> = [];

    if (typeof body.enabled === 'boolean') {
      rows.push({ key: 'training_hub_coming_soon', value: body.enabled ? 'true' : 'false' });
    }
    if (typeof body.launchDate === 'string') {
      const trimmed = body.launchDate.trim();
      rows.push({ key: 'training_hub_launch_date', value: trimmed });
      // An empty launch_date can't support an auto-launch — clear the flag so
      // the cron doesn't look at a dangling enabled=true without a target time.
      if (!trimmed) rows.push({ key: 'training_hub_auto_launch', value: 'false' });
    }
    if (typeof body.autoLaunch === 'boolean') {
      rows.push({ key: 'training_hub_auto_launch', value: body.autoLaunch ? 'true' : 'false' });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    const { error } = await sb
      .from('training_settings')
      .upsert(rows, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, ...toResponse(await readAll()) });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
