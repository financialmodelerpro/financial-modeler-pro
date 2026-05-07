/**
 * /api/admin/platform-module-pages
 *
 * Admin upsert for module page sections (hero / features / how_it_works / cta /
 * testimonials). Single endpoint for both create and update because pages are
 * keyed by (module_id, page_section), so an upsert covers both flows.
 *
 * GET   - list all pages for a module_id (?moduleId=<uuid>)
 * POST  - upsert a page section
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  adminListPlatformModulePages,
  adminUpsertPlatformModulePage,
  type PlatformModulePageInput,
} from '@/src/shared/cms/platform-modules';

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const moduleId = new URL(req.url).searchParams.get('moduleId') ?? '';
  if (!moduleId) {
    return NextResponse.json({ error: 'Missing moduleId' }, { status: 400 });
  }
  const pages = await adminListPlatformModulePages(moduleId);
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Partial<PlatformModulePageInput>;
    if (!body.module_id || !body.page_section) {
      return NextResponse.json(
        { error: 'Missing required fields: module_id, page_section' },
        { status: 400 },
      );
    }
    const result = await adminUpsertPlatformModulePage(body as PlatformModulePageInput);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ page: result.page });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to upsert page' },
      { status: 500 },
    );
  }
}
