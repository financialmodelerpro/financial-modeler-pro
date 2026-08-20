import { NextRequest, NextResponse } from 'next/server';
import { resolveComingSoonFromDate } from '@/src/shared/comingSoon/resolveFromDate';
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
  // Three-state banner (2026-08-09c): the master switch plus the post-launch
  // copy and its call to action. Countdown vs launched is derived from the
  // date, never stored, so only the OFF choice needs persisting.
  'modeling_hub_launch_banner_enabled',
  'modeling_hub_launched_headline',
  'modeling_hub_launched_subline',
  'modeling_hub_launched_cta_label',
  'modeling_hub_launched_cta_href',
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
  // THE DERIVED STATE, computed by the SAME pure rule the live guard uses, so
  // the card cannot claim the hub is live while the gate keeps it shut. That
  // divergence is exactly what happened on 2026-08-20.
  const resolved = resolveComingSoonFromDate({
    flag: map.get('modeling_hub_coming_soon') === 'true',
    launchDate: map.get('modeling_hub_launch_date') ?? '',
    nowMs: Date.now(),
  });
  return {
    enabled:            map.get('modeling_hub_coming_soon') === 'true',
    // What the hub ACTUALLY does right now, and why.
    effectiveEnabled:   resolved.enabled,
    effectiveSource:    resolved.source,
    effectiveReason:    resolved.reason,
    launchDate:         map.get('modeling_hub_launch_date') ?? '',
    autoLaunch:         map.get('modeling_hub_auto_launch') === 'true',
    lastAutoLaunchedAt: map.get('modeling_hub_last_auto_launched_at') ?? '',
    // Banner copy. Returned RAW (blank when unset) rather than defaulted here,
    // so the admin field shows empty and the placeholder communicates the
    // default, instead of the default looking like a saved value.
    headline:           map.get('modeling_hub_launch_headline') ?? '',
    subline:            map.get('modeling_hub_launch_subline') ?? '',
    platformSlug:       map.get('modeling_hub_launch_platform') ?? '',
    // ABSENT MEANS ON, so an install predating this key is unaffected.
    bannerEnabled:      map.get('modeling_hub_launch_banner_enabled') !== 'false',
    launchedHeadline:   map.get('modeling_hub_launched_headline') ?? '',
    launchedSubline:    map.get('modeling_hub_launched_subline') ?? '',
    launchedCtaLabel:   map.get('modeling_hub_launched_cta_label') ?? '',
    launchedCtaHref:    map.get('modeling_hub_launched_cta_href') ?? '',
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
      bannerEnabled?: boolean;
      launchedHeadline?: string; launchedSubline?: string;
      launchedCtaLabel?: string; launchedCtaHref?: string;
    };
    const sb = getServerClient();
    const rows: Array<{ key: string; value: string }> = [];

    if (typeof body.enabled === 'boolean') {
      rows.push({ key: 'modeling_hub_coming_soon', value: body.enabled ? 'true' : 'false' });
    }
    if (typeof body.launchDate === 'string') {
      rows.push({ key: 'modeling_hub_launch_date', value: body.launchDate.trim() });
    }
    // `autoLaunch` is RETIRED (2026-08-20) and no longer written. The launch
    // date decides the Coming Soon state directly, so there is no cron firing
    // to authorise and Modeling has been removed from that cron. A client
    // still sending the field is accepted and ignored rather than erroring,
    // because rejecting it would break an admin screen mid-deploy; the stored
    // row is left exactly as it is, which destroys nothing.
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
    if (typeof body.bannerEnabled === 'boolean') {
      rows.push({ key: 'modeling_hub_launch_banner_enabled', value: body.bannerEnabled ? 'true' : 'false' });
    }
    // Post-launch copy. Empty is a meaningful write here too (it restores the
    // default), so these are stored as sent rather than skipped when blank.
    if (typeof body.launchedHeadline === 'string') {
      rows.push({ key: 'modeling_hub_launched_headline', value: body.launchedHeadline.trim() });
    }
    if (typeof body.launchedSubline === 'string') {
      rows.push({ key: 'modeling_hub_launched_subline', value: body.launchedSubline.trim() });
    }
    if (typeof body.launchedCtaLabel === 'string') {
      rows.push({ key: 'modeling_hub_launched_cta_label', value: body.launchedCtaLabel.trim() });
    }
    if (typeof body.launchedCtaHref === 'string') {
      rows.push({ key: 'modeling_hub_launched_cta_href', value: body.launchedCtaHref.trim() });
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
