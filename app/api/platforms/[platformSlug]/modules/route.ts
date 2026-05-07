/**
 * /api/platforms/[platformSlug]/modules
 *
 * GET  (public)  - list visible modules for a platform (status != 'hidden').
 *                  Used by both the marketing site and the REFM workspace
 *                  sidebar dynamic fetch (P-Sync Task #24).
 * POST (admin)   - create a new platform module.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  getPlatformModules,
  adminListPlatformModules,
  adminUpsertPlatformModule,
  type PlatformModuleInput,
} from '@/src/shared/cms/platform-modules';

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ platformSlug: string }> },
) {
  const { platformSlug } = await ctx.params;
  const includeHidden = new URL(req.url).searchParams.get('includeHidden') === '1';

  if (includeHidden) {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const modules = await adminListPlatformModules(platformSlug);
    return NextResponse.json({ modules });
  }

  const modules = await getPlatformModules(platformSlug);
  return NextResponse.json(
    { modules },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ platformSlug: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { platformSlug } = await ctx.params;
    const body = (await req.json()) as Partial<PlatformModuleInput>;
    if (!body.slug || !body.name || !body.short_name || typeof body.number !== 'number') {
      return NextResponse.json(
        { error: 'Missing required fields: slug, name, short_name, number' },
        { status: 400 },
      );
    }
    const result = await adminUpsertPlatformModule({
      ...body,
      platform_slug: platformSlug,
    } as PlatformModuleInput);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ module: result.module });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create module' },
      { status: 500 },
    );
  }
}
