/**
 * /api/admin/projects - the admin Projects Browser API, REBUILT 2026-08-30
 * against the real per-platform project tables via the PROJECT_SOURCES
 * registry (src/shared/admin/projectSources.ts). The previous version queried
 * the LEGACY `projects` table, which holds zero rows on prod, so the browser
 * always showed nothing and its delete actions could never find a real
 * project. No table name is hardcoded here: adding a platform (ERM, BVM) is
 * one registry entry.
 *
 *   GET    ?platform=<key>          -> normalized rows from every source (or
 *                                      one), each carrying its platform, owner,
 *                                      archived state and version count, plus
 *                                      the source list for the UI filter.
 *   POST   { action, platform, id } -> 'archive' | 'unarchive' (reversible,
 *                                      writes the platform's own archived
 *                                      column, the SAME flag the user's own
 *                                      archive flow and the project cap read).
 *   DELETE { platform, id, confirmName } -> HARD delete. confirmName must
 *                                      match the project's name exactly
 *                                      (server-side defense on top of the
 *                                      modal), because the FK cascades destroy
 *                                      the whole model: versions with their
 *                                      change log, report decks and deck
 *                                      versions, fund terms, parties.
 *
 * Every mutation is audited to admin_audit_log with the platform and name.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { writeAuditLog } from '@/src/shared/audit';
import { PROJECT_SOURCES, getProjectSource, daysRemaining, RETENTION_DAYS, type ProjectSource } from '@/src/shared/admin/projectSources';
import { restoreDeletedProject } from '@/src/shared/admin/projectRetention';

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, adminId: null };
  if ((session.user as { role?: string }).role !== 'admin') {
    return { error: 'Admin only', status: 403, adminId: null };
  }
  return { error: null, status: 200, adminId: session.user.id as string };
}

interface NormalizedProject {
  platform: string;
  platformLabel: string;
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  versionCount: number;
  /** Soft-delete stamp (mig 224), null when live. */
  deletedAt: string | null;
  /** Whole days before the purge hard deletes it; null when not deleted. */
  daysLeft: number | null;
}

const PER_SOURCE_LIMIT = 200;

async function listSource(sb: ReturnType<typeof getServerClient>, source: ProjectSource): Promise<{ rows: NormalizedProject[]; error: string | null }> {
  const baseCols = [
    'id',
    source.nameColumn,
    source.ownerColumn,
    'created_at',
    'updated_at',
    ...(source.archivedColumn ? [source.archivedColumn] : []),
    'users(email, name)',
  ];
  // The soft-delete column is selected when the platform declares one, and
  // dropped on a database that does not have it yet (pre-224), where every
  // project is live by definition.
  const run = (cols: string[]) => sb
    .from(source.table)
    .select(cols.join(', '))
    .order('updated_at', { ascending: false })
    .range(0, PER_SOURCE_LIMIT - 1);

  const wantDeleted = !!source.deletedColumn;
  let { data, error } = await run(wantDeleted ? [...baseCols, source.deletedColumn!] : baseCols);
  if (error && wantDeleted) {
    ({ data, error } = await run(baseCols));
  }
  if (error) return { rows: [], error: `${source.key}: ${error.message}` };

  const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const counts = await Promise.all(raw.map(async (r) => {
    if (!source.versionsTable || !source.versionsFk) return 0;
    try {
      const { count } = await sb
        .from(source.versionsTable)
        .select('id', { count: 'exact', head: true })
        .eq(source.versionsFk, r.id as string);
      return count ?? 0;
    } catch {
      return 0;
    }
  }));

  return {
    error: null,
    rows: raw.map((r, i) => {
      const owner = r.users as { email?: string | null; name?: string | null } | null;
      const deletedAt = source.deletedColumn ? ((r[source.deletedColumn] as string | null) ?? null) : null;
      return {
        platform: source.key,
        platformLabel: source.shortLabel,
        id: r.id as string,
        name: (r[source.nameColumn] as string | null) ?? '(unnamed project)',
        archived: source.archivedColumn ? !!r[source.archivedColumn] : false,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        userId: r[source.ownerColumn] as string,
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.name ?? null,
        versionCount: counts[i],
        deletedAt,
        daysLeft: deletedAt ? daysRemaining(deletedAt) : null,
      };
    }),
  };
}

export async function GET(req: NextRequest) {
  const { error, status } = await guard();
  if (error) return NextResponse.json({ error }, { status });

  const platform = req.nextUrl.searchParams.get('platform') ?? '';
  const sources = platform ? PROJECT_SOURCES.filter((s) => s.key === platform) : PROJECT_SOURCES;
  if (platform && sources.length === 0) {
    return NextResponse.json({ error: `Unknown platform "${platform}"` }, { status: 400 });
  }

  const sb = getServerClient();
  const results = await Promise.all(sources.map((s) => listSource(sb, s)));
  const projects = results.flatMap((r) => r.rows)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  // A source whose table errors (e.g. a platform table not yet migrated)
  // contributes zero rows and a note, never a broken browser.
  const sourceErrors = results.map((r) => r.error).filter(Boolean) as string[];

  return NextResponse.json({
    projects,
    sources: PROJECT_SOURCES.map((s) => ({
      key: s.key, label: s.label, shortLabel: s.shortLabel,
      supportsArchive: !!s.archivedColumn,
      supportsRestore: !!s.deletedColumn,
    })),
    retentionDays: RETENTION_DAYS,
    sourceErrors,
  });
}

/** Resolve a project through the registry, so a mutation can never touch a
 *  table the registry does not name. */
async function resolveProject(sb: ReturnType<typeof getServerClient>, source: ProjectSource, id: string) {
  const { data } = await sb
    .from(source.table)
    .select(`id, ${source.nameColumn}, ${source.ownerColumn}`)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return { id: r.id as string, name: (r[source.nameColumn] as string | null) ?? '', userId: r[source.ownerColumn] as string };
}

// ── POST: archive / unarchive (reversible) ──────────────────────────────────
export async function POST(req: NextRequest) {
  const { error, status, adminId } = await guard();
  if (error || !adminId) return NextResponse.json({ error }, { status });

  const body = await req.json().catch(() => ({})) as { action?: string; platform?: string; id?: string };
  const source = getProjectSource(body.platform ?? '');
  if (!source) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // ── RESTORE a soft-deleted project (mig 224) ──────────────────────────────
  // Registry driven and cap-tolerant by design (see restoreDeletedProject).
  if (body.action === 'restore') {
    const res = await restoreDeletedProject(getServerClient(), source.key, body.id);
    if (!res.ok) {
      const status = res.code === 'not_found' ? 404 : res.code === 'failed' ? 500 : 400;
      return NextResponse.json({ error: res.error, code: res.code }, { status });
    }
    await writeAuditLog({
      adminId,
      action: 'restore_project',
      targetUserId: res.userId,
      afterValue: { platform: source.key, project_id: body.id, name: res.name },
    });
    return NextResponse.json({ ok: true, restored: res.name });
  }

  if (body.action !== 'archive' && body.action !== 'unarchive') {
    return NextResponse.json({ error: 'action must be archive, unarchive or restore' }, { status: 400 });
  }
  if (!source.archivedColumn) {
    return NextResponse.json({ error: `${source.shortLabel} projects have no archive state` }, { status: 400 });
  }

  const sb = getServerClient();
  const project = await resolveProject(sb, source, body.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { error: dbErr } = await sb
    .from(source.table)
    .update({ [source.archivedColumn]: body.action === 'archive' })
    .eq('id', body.id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  await writeAuditLog({
    adminId,
    action: body.action === 'archive' ? 'archive_project' : 'unarchive_project',
    targetUserId: project.userId,
    afterValue: { platform: source.key, project_id: project.id, name: project.name },
  });
  return NextResponse.json({ ok: true });
}

// ── DELETE: hard delete (cascades take the whole model) ─────────────────────
export async function DELETE(req: NextRequest) {
  const { error, status, adminId } = await guard();
  if (error || !adminId) return NextResponse.json({ error }, { status });

  const body = await req.json().catch(() => ({})) as { platform?: string; id?: string; confirmName?: string };
  const source = getProjectSource(body.platform ?? '');
  if (!source) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = getServerClient();
  const project = await resolveProject(sb, source, body.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // The name must be typed back exactly: this delete destroys the project's
  // versions, change log, report decks, fund terms and parties via FK
  // cascades, and cannot be undone.
  if ((body.confirmName ?? '') !== project.name) {
    return NextResponse.json({ error: 'confirmName does not match the project name; nothing was deleted', code: 'confirm_mismatch' }, { status: 400 });
  }

  const { error: dbErr } = await sb.from(source.table).delete().eq('id', body.id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  await writeAuditLog({
    adminId,
    action: 'delete_project',
    targetUserId: project.userId,
    afterValue: { platform: source.key, project_id: project.id, name: project.name },
  });
  return NextResponse.json({ ok: true });
}
