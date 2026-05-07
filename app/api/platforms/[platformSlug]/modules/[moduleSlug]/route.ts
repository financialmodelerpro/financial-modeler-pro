/**
 * /api/platforms/[platformSlug]/modules/[moduleSlug]
 *
 * GET    (public) - module + visible page sections (used by per-module marketing page).
 * PATCH  (admin)  - update fields on an existing module.
 * DELETE (admin)  - remove a module (cascades to its pages).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  getPlatformModuleWithPages,
  adminListPlatformModules,
  adminUpsertPlatformModule,
  adminDeletePlatformModule,
  type PlatformModuleInput,
} from '@/src/shared/cms/platform-modules';

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ platformSlug: string; moduleSlug: string }> },
) {
  const { platformSlug, moduleSlug } = await ctx.params;
  const data = await getPlatformModuleWithPages(platformSlug, moduleSlug);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(
    { module: data, pages: data.pages },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ platformSlug: string; moduleSlug: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { platformSlug } = await ctx.params;
    const body = (await req.json()) as Partial<PlatformModuleInput> & { id: string };
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const result = await adminUpsertPlatformModule({
      ...body,
      platform_slug: platformSlug,
    } as PlatformModuleInput);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ module: result.module });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update module' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ platformSlug: string; moduleSlug: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const idParam = new URL(req.url).searchParams.get('id');
    let targetId = idParam;
    if (!targetId) {
      const { platformSlug, moduleSlug } = await ctx.params;
      const all = await adminListPlatformModules(platformSlug);
      const found = all.find((m) => m.slug === moduleSlug);
      if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      targetId = found.id;
    }

    const result = await adminDeletePlatformModule(targetId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete module' },
      { status: 500 },
    );
  }
}
