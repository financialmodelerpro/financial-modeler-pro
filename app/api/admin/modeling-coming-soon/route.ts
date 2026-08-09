import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Hub-level launch settings. The launch date here drives BOTH the public
// countdown banner (src/hubs/main/components/launch/) and the auto-launch cron,
// deliberately: one date, so what a visitor is counting down to and the moment
// the hub actually flips cannot drift apart.
//
// The three banner-copy keys (2026-08-09) are admin-editable text, so the
// announcement changes without a deploy. They live in the same free-form
// key/value table (`training_settings.key` is the primary key with no
// constraint on the key set), so they needed NO migration.
const KEYS = [
  'modeling_hub_coming_soon',
  'modeling_hub_launch_date',
  'modeling_hub_auto_launch',
  'modeling_hub_last_auto_launched_at',
  'modeling_hub_launch_headline',
  'modeling_hub_launch_subline',
  'modeling_hub_launch_platform',
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
    enabled:            map.get('modeling_hub_coming_soon') === 'true',
    launchDate:         map.get('modeling_hub_launch_date') ?? '',
    autoLaunch:         map.get('modeling_hub_auto_launch') === 'true',
    lastAutoLaunchedAt: map.get('modeling_hub_last_auto_launched_at') ?? '',
    // Banner copy. Returned RAW (blank when unset) rather than defaulted here,
    // so the admin field shows empty and the placeholder communicates the
    // default, instead of the default looking like a saved value.
    headline:           map.get('modeling_hub_launch_headline') ?? '',
    subline:            map.get('modeling_hub_launch_subline') ?? '',
    platformSlug:       map.get('modeling_hub_launch_platform') ?? '',
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
    const body = await req.json() as {
      enabled?: boolean; launchDate?: string; autoLaunch?: boolean;
      headline?: string; subline?: string; platformSlug?: string;
    };
    const sb = getServerClient();
    const rows: Array<{ key: string; value: string }> = [];

    if (typeof body.enabled === 'boolean') {
      rows.push({ key: 'modeling_hub_coming_soon', value: body.enabled ? 'true' : 'false' });
    }
    if (typeof body.launchDate === 'string') {
      const trimmed = body.launchDate.trim();
      rows.push({ key: 'modeling_hub_launch_date', value: trimmed });
      // An empty launch_date can't support an auto-launch, clear the flag so
      // the cron doesn't look at a dangling enabled=true without a target time.
      if (!trimmed) rows.push({ key: 'modeling_hub_auto_launch', value: 'false' });
    }
    if (typeof body.autoLaunch === 'boolean') {
      rows.push({ key: 'modeling_hub_auto_launch', value: body.autoLaunch ? 'true' : 'false' });
    }
    // Banner copy. An empty string is a MEANINGFUL write (it clears the custom
    // text and restores the default at render), so these are stored as sent
    // rather than skipped when blank.
    if (typeof body.headline === 'string') {
      rows.push({ key: 'modeling_hub_launch_headline', value: body.headline.trim() });
    }
    if (typeof body.subline === 'string') {
      rows.push({ key: 'modeling_hub_launch_subline', value: body.subline.trim() });
    }
    if (typeof body.platformSlug === 'string') {
      rows.push({ key: 'modeling_hub_launch_platform', value: body.platformSlug.trim() });
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
