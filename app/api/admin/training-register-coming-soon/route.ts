import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * Parallel to /api/admin/training-coming-soon, but scoped to the
 * /training/register page only. Reads and writes:
 *   training_hub_register_coming_soon
 *   training_hub_register_launch_date
 *
 * The signin-side toggle keeps its own keys and its own endpoint so the
 * two pages can be controlled independently. Auto-launch semantics are
 * signin-only for now (no register-side cron), so this route exposes
 * just the enabled + launchDate pair.
 */

const KEYS = [
  'training_hub_register_coming_soon',
  'training_hub_register_launch_date',
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
    enabled:    map.get('training_hub_register_coming_soon') === 'true',
    launchDate: map.get('training_hub_register_launch_date') ?? '',
  };
}

export async function GET() {
  try {
    return NextResponse.json(toResponse(await readAll()));
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
      rows.push({ key: 'training_hub_register_coming_soon', value: body.enabled ? 'true' : 'false' });
    }
    if (typeof body.launchDate === 'string') {
      rows.push({ key: 'training_hub_register_launch_date', value: body.launchDate.trim() });
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
