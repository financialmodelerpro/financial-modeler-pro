/**
 * /api/refm/projects/[id] (Phase M1.6/2)
 *
 *   GET    → load the project metadata + the snapshot referenced by
 *            current_version_id (one round-trip for hydration). Falls
 *            back to the most recent version row if the pointer is
 *            NULL (mid-create or a row written by a partial failure).
 *   PATCH  → update project metadata (name / location / status /
 *            asset_mix). Snapshot saves go through POST /[id]/versions.
 *   DELETE → drop the project + cascade all its versions.
 *
 * Auth: NextAuth session required. Every query joins on user_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getVersionById,
  getLatestVersion,
  updateProject,
  deleteProject,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/types';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

// ── GET /api/refm/projects/[id] ─────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;

  const { row: project, error: projErr } = await getProject(userId, id);
  if (projErr) return serverError(projErr);
  if (!project) return notFound();

  // Strip user_id from the response (caller is the owner).
  const { user_id: _u, ...projectOut } = project;

  // Snapshot: prefer current_version_id, fall back to latest.
  let version = null;
  if (project.current_version_id) {
    const { row, error } = await getVersionById(project.id, project.current_version_id);
    if (error) return serverError(error);
    version = row;
  }
  if (!version) {
    const { row, error } = await getLatestVersion(project.id);
    if (error) return serverError(error);
    version = row;
  }

  return NextResponse.json({ project: projectOut, version });
}

// ── PATCH /api/refm/projects/[id] ───────────────────────────────────────────
// Body: subset of { name, location, status, assetMix }. Empty body returns
// the unchanged row.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;

  let body: {
    name?:     string;
    location?: string | null;
    status?:   ProjectStatus;
    assetMix?: string[];
  };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) return badRequest('name cannot be empty.');
    update.name = trimmed;
  }
  if (body.location !== undefined) update.location = body.location;
  if (body.status !== undefined) {
    if (!(PROJECT_STATUSES as readonly string[]).includes(body.status)) {
      return badRequest(`status must be one of: ${PROJECT_STATUSES.join(', ')}`);
    }
    update.status = body.status;
  }
  if (body.assetMix !== undefined) update.asset_mix = body.assetMix;

  if (Object.keys(update).length === 0) {
    // Read-back so the client gets a fresh (unchanged) row.
    const { row, error } = await getProject(userId, id);
    if (error) return serverError(error);
    if (!row) return notFound();
    const { user_id: _u, ...rest } = row;
    return NextResponse.json({ project: rest });
  }

  const { row, error } = await updateProject(userId, id, update);
  if (error) return serverError(error);
  if (!row) return notFound();
  const { user_id: _u, ...rest } = row;
  return NextResponse.json({ project: rest });
}

// ── DELETE /api/refm/projects/[id] ──────────────────────────────────────────
// Cascade is handled by refm_project_versions.project_id ON DELETE CASCADE.
// Verifies ownership first because Supabase JS doesn't return rows-affected
// on a SERVICE_ROLE delete; without the check the route would silently
// return 200 for an id that belongs to another user.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;

  const { row, error: ownerErr } = await getProject(userId, id);
  if (ownerErr) return serverError(ownerErr);
  if (!row) return notFound();

  const { error } = await deleteProject(userId, id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
