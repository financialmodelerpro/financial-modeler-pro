/**
 * /api/admin/ai-features (AI foundation Unit 5)
 *
 * GET   -> every registered AI feature, grouped by platform, with its caps and
 *          whatever usage the metering layer can report.
 * PATCH -> toggle a feature on/off, or set its per-plan caps.
 *
 * Admin only, same guard as every other /api/admin route: a NextAuth session
 * with role admin, else 401.
 *
 * This route EDITS CONFIG. It grants nothing and enforces nothing. The gate
 * that decides whether a generation may run stays server-side in the metering
 * layer and in listEnabledAiFeatures; flipping a toggle here changes what those
 * read, it does not bypass them.
 *
 * force-dynamic because an admin list must never be served from a cache: a
 * stale toggle state would read as "the change did not save".
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { listAiFeatures } from '@/src/shared/ai/registry';
import { setAiFeatureCaps, setAiFeatureEnabled } from '@/src/shared/ai/registryAdmin';
import { loadAiUsage } from '@/src/shared/ai/usage';
import { AI_PLATFORM_ALL } from '@/src/shared/ai/registryTypes';
import { KNOWN_PLAN_KEYS } from '@/src/shared/entitlements/gate';
import { PLATFORMS } from '@/src/hubs/modeling/config/platforms';

export const dynamic = 'force-dynamic';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!session?.user && (session.user as { role?: string }).role === 'admin';
}

/** Display label for a platform slug, derived from the platform catalog rather
 *  than hardcoded, so a new platform needs no edit here. */
function platformLabel(slug: string): string {
  if (slug === AI_PLATFORM_ALL) return 'All platforms';
  const p = PLATFORMS.find((x) => x.slug === slug);
  return p ? `${p.name} (${p.shortName})` : slug;
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || undefined;
  const snapshot = await listAiFeatures(platform);

  if (!snapshot.migrationApplied) {
    return NextResponse.json({
      migrationApplied: false,
      error: snapshot.error ?? 'The AI feature registry tables are not present.',
      groups: [], planKeys: [...KNOWN_PLAN_KEYS], usage: { available: false, reason: 'The registry is not installed.' },
    });
  }

  // Plan columns: the canonical plan keys first, then any extra key a feature
  // actually carries a cap for (a plan created after the code was written).
  // Data-driven, so a new plan appears without a code change.
  const extra = new Set<string>();
  for (const f of snapshot.features) {
    for (const k of Object.keys(f.caps)) if (!(KNOWN_PLAN_KEYS as readonly string[]).includes(k)) extra.add(k);
  }
  const planKeys = [...KNOWN_PLAN_KEYS, ...Array.from(extra).sort()];

  // Group by platform. Order: real platforms in catalog order, then the
  // cross-platform bucket last.
  const bySlug = new Map<string, typeof snapshot.features>();
  for (const f of snapshot.features) {
    const list = bySlug.get(f.platformSlug) ?? [];
    list.push(f);
    bySlug.set(f.platformSlug, list);
  }
  const order = (slug: string): number => {
    if (slug === AI_PLATFORM_ALL) return 9999;
    const i = PLATFORMS.findIndex((p) => p.slug === slug);
    return i === -1 ? 9998 : i;
  };
  const groups = Array.from(bySlug.entries())
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([slug, features]) => ({ platformSlug: slug, platformLabel: platformLabel(slug), features }));

  const usage = await loadAiUsage(platform);

  return NextResponse.json({
    migrationApplied: true,
    groups,
    planKeys,
    usage,
    skipped: snapshot.skipped,
  });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as
    | { featureId?: string; platformSlug?: string; enabled?: boolean; caps?: Record<string, number> }
    | null;

  if (!body?.featureId || !body.platformSlug) {
    return NextResponse.json({ error: 'featureId and platformSlug are required.' }, { status: 400 });
  }
  const { featureId, platformSlug } = body;

  const hasEnabled = typeof body.enabled === 'boolean';
  const hasCaps = !!body.caps && typeof body.caps === 'object';
  if (!hasEnabled && !hasCaps) {
    return NextResponse.json({ error: 'Supply enabled, caps, or both.' }, { status: 400 });
  }

  const statusFor = (kind: string): number =>
    kind === 'not_found' ? 404 : kind === 'invalid' ? 400 : 500;

  // Both edits apply in one request when both are sent, so the panel saves a row
  // in a single round trip. The toggle goes first: if the caps write then fails,
  // the feature is left in a known state rather than half-saved with an unknown
  // toggle. Each setter returns the re-read feature, so the response always
  // reflects the STORED row rather than what the client hoped it wrote.
  let latest = null as Awaited<ReturnType<typeof setAiFeatureEnabled>> | null;

  if (hasEnabled) {
    latest = await setAiFeatureEnabled(featureId, platformSlug, body.enabled as boolean);
    if (!latest.ok) return NextResponse.json({ error: latest.errors.join(' ') }, { status: statusFor(latest.kind) });
  }

  if (hasCaps) {
    latest = await setAiFeatureCaps(featureId, platformSlug, body.caps as Record<string, number>);
    if (!latest.ok) return NextResponse.json({ error: latest.errors.join(' ') }, { status: statusFor(latest.kind) });
  }

  return latest && latest.ok
    ? NextResponse.json({ ok: true, feature: latest.feature })
    : NextResponse.json({ error: 'Nothing was written.' }, { status: 500 });
}
