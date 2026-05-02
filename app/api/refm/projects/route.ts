/**
 * /api/refm/projects (Phase M1.6/2)
 *
 *   GET  → list the calling user's projects (metadata only — no
 *          snapshot payload). Sorted by updated_at DESC for the picker.
 *   POST → create a new project (mints the project row + the first
 *          version row carrying the supplied snapshot, then stamps
 *          current_version_id back onto the project).
 *
 * Auth: NextAuth session required. Every query is filtered by
 * `user_id = session.user.id` even though the SERVICE_ROLE client
 * bypasses RLS — the application layer is the access boundary.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listProjects,
  insertProject,
  insertVersion,
  setProjectCurrentVersion,
  deleteProject,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import {
  SCHEMA_VERSION,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/types';
import type { HydrateSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

// ── GET /api/refm/projects ──────────────────────────────────────────────────
export async function GET() {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  const { rows, error } = await listProjects(userId);
  if (error) return serverError(error);
  // Strip user_id before sending back — the caller is the owner; no
  // need to mirror it on every list item. version_count was already
  // decorated by the helper.
  const projects = rows.map(({ user_id: _u, ...rest }) => rest);
  return NextResponse.json({ projects });
}

// ── POST /api/refm/projects ─────────────────────────────────────────────────
// Body: { name: string, snapshot: HydrateSnapshot, location?, status?, assetMix? }
// Three sequential writes: project row, first version row, then the
// current_version_id pointer. On partial failure the orphan project is
// deleted so the user doesn't see a half-created entry in the picker.
export async function POST(req: NextRequest) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: {
    name?:     string;
    snapshot?: HydrateSnapshot;
    location?: string | null;
    status?:   ProjectStatus;
    assetMix?: string[];
  };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  const name = body.name?.trim();
  if (!name) return badRequest('name is required.');
  if (!body.snapshot) return badRequest('snapshot is required.');

  const status: ProjectStatus = body.status && (PROJECT_STATUSES as readonly string[]).includes(body.status)
    ? body.status
    : 'Draft';

  // Step 1: project row.
  const { row: projectRow, error: projErr } = await insertProject({
    user_id:        userId,
    name,
    location:       body.location ?? null,
    status,
    asset_mix:      body.assetMix ?? [],
    schema_version: SCHEMA_VERSION,
  });
  if (projErr || !projectRow) return serverError(projErr ?? 'Failed to create project.');

  // Step 2: first version row.
  const { row: versionRow, error: verErr } = await insertVersion({
    project_id:     projectRow.id,
    version_number: 1,
    schema_version: SCHEMA_VERSION,
    snapshot:       body.snapshot,
  });
  if (verErr || !versionRow) {
    await deleteProject(userId, projectRow.id);
    return serverError(verErr ?? 'Failed to write initial version.');
  }

  // Step 3: pointer back to the version. Failure here leaves the
  // project + version intact (the GET route falls back to the most
  // recent version when the pointer is null), so we return the rows
  // we have plus the error rather than cleaning up.
  const { error: ptrErr } = await setProjectCurrentVersion(projectRow.id, versionRow.id);
  if (ptrErr) return serverError(ptrErr);

  return NextResponse.json({
    project: { ...projectRow, current_version_id: versionRow.id },
    version: versionRow,
  });
}
