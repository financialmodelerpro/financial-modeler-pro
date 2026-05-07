/**
 * /api/admin/platform-module-pages/[id]
 *
 * PATCH  - update a single page section by id (alternative to upsert flow).
 * DELETE - remove a page section.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  adminUpsertPlatformModulePage,
  adminDeletePlatformModulePage,
  type PlatformModulePageInput,
} from '@/src/shared/cms/platform-modules';

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<PlatformModulePageInput>;
    const result = await adminUpsertPlatformModulePage({
      ...body,
      id,
    } as PlatformModulePageInput);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ page: result.page });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update page' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await ctx.params;
    const result = await adminDeletePlatformModulePage(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete page' },
      { status: 500 },
    );
  }
}
