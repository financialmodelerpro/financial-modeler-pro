/**
 * /api/refm/projects/[id] (Phase M1.6/2)
 *
 *   GET    → load the project metadata + the snapshot referenced by
 *            current_version_id (one round-trip for hydration). Falls
 *            back to the most recent version row if the pointer is
 *            NULL (mid-create or a row written by a partial failure).
 *   PATCH  → update project metadata (name / location / status /
 *            asset_mix). Snapshot saves go through POST /[id]/versions.
 *   DELETE → SOFT delete: hide the project and start the retention clock.
 *            The row and its versions survive until the purge (mig 224).
 *
 * Auth: NextAuth session required. Every query joins on user_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getProjectForWrite,
  getVersionById,
  getLatestVersion,
  updateProject,
  softDeleteProject,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId, getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/types';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { canAddActiveProject, writeBlockReason } from '@/src/shared/entitlements/gate';
import { RETENTION_DAYS } from '@/src/shared/admin/projectSources';

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
// Body: subset of { name, location, status, assetMix, archived, priority }.
// Empty body returns the unchanged row.
//
// `priority` is a METADATA edit, so it is blocked on an archived project like
// every other one: an archived project is view-only, and flagging a view-only
// project urgent would be a write the user cannot act on. `sort_order` is NOT
// settable here at all; manual order is a whole-group operation and goes
// through POST /api/refm/projects/reorder, so a single card can never be given
// a position that contradicts its neighbours.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;

  let body: {
    name?:     string;
    location?: string | null;
    status?:   ProjectStatus;
    assetMix?: string[];
    archived?: boolean;
    priority?: boolean;
  };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  // Read the current row so we know the live archived state (the choke point
  // for both the archive toggle and the "archived = view-only" edit block).
  const { row: current, error: curErr } = await getProjectForWrite(userId, id);
  if (curErr) return serverError(curErr);
  if (!current) return notFound();

  const update: Record<string, unknown> = {};

  // ── Archive toggle (handled before the view-only block, since unarchiving an
  //    archived project is itself an allowed write). ──────────────────────────
  const wantsArchiveChange = typeof body.archived === 'boolean' && body.archived !== current.archived;
  if (wantsArchiveChange) {
    if (body.archived === true) {
      // Archiving: frees a slot. Trial plan can never archive.
      const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
      if (!gate.archiveAllowed) {
        return NextResponse.json(
          { error: 'Your plan does not include archiving. Upgrade to archive projects.', code: 'ARCHIVE_NOT_ALLOWED', planKey: gate.planKey },
          { status: 403 },
        );
      }
      update.archived = true;
    } else {
      // Unarchiving: treated exactly like create (must fit under the cap).
      const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
      if (!canAddActiveProject(gate.activeProjectCount, gate.projectLimit)) {
        return NextResponse.json(
          {
            error: 'Project limit reached. Archive another project or upgrade to unarchive this one.',
            code: 'CAP_REACHED',
            projectLimit: gate.projectLimit,
            activeProjectCount: gate.activeProjectCount,
            archiveAllowed: gate.archiveAllowed,
            planKey: gate.planKey,
          },
          { status: 403 },
        );
      }
      update.archived = false;
    }
  }

  // ── Metadata edits: blocked while the project is archived (view-only),
  //    UNLESS the same request is unarchiving it. ─────────────────────────────
  const hasMetadataEdit =
    typeof body.name === 'string' || body.location !== undefined ||
    body.status !== undefined || body.assetMix !== undefined ||
    body.priority !== undefined;
  const willBeArchived = update.archived === true || (current.archived && update.archived !== false);
  if (hasMetadataEdit && willBeArchived) {
    return NextResponse.json(
      { error: 'This project is archived and is view-only. Unarchive it to edit.', code: 'PROJECT_ARCHIVED' },
      { status: 403 },
    );
  }

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
  if (body.priority !== undefined) {
    // Rejected rather than coerced: a truthy string from a sloppy client must
    // not become a silent true. One flag, so the only valid values are the
    // two booleans.
    if (typeof body.priority !== 'boolean') return badRequest('priority must be a boolean.');
    update.priority = body.priority;
  }

  if (Object.keys(update).length === 0) {
    // Read-back so the client gets a fresh (unchanged) row.
    const { row, error } = await getProjectForWrite(userId, id);
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
// SOFT delete (mig 224): the project leaves the user's world (hidden from the
// list, cannot be opened, out of the project cap) but the row and every
// version survive, so the deletion is recoverable for RETENTION_DAYS. The
// daily purge does the hard delete, with the existing cascades.
//
// Verifies ownership first because Supabase JS doesn't return rows-affected
// on a SERVICE_ROLE write; without the check the route would silently
// return 200 for an id that belongs to another user. (getProject already
// excludes soft-deleted rows, so a second DELETE is a 404, not a no-op 200.)
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const { id } = await ctx.params;

  const { row, error: ownerErr } = await getProjectForWrite(userId, id);
  if (ownerErr) return serverError(ownerErr);
  if (!row) return notFound();

  // Read-only GRACE blocks deletion, like every other write choke point.
  // The reason is specific to deletion, not just symmetry: a grace user is on
  // a path to LAPSED (no access at all), so a project deleted now would reach
  // the end of its retention window while the user cannot see it, ask for it
  // back, or even log in to notice. Renewing restores the ability to delete.
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  if (gate.readOnly) {
    return NextResponse.json(
      {
        error: 'Your subscription has expired, so your projects are read-only. Renew to delete projects.',
        code: writeBlockReason(gate) ?? 'READ_ONLY_GRACE',
      },
      { status: 403 },
    );
  }

  const { error, unsupported } = await softDeleteProject(userId, id);
  if (unsupported) {
    return NextResponse.json(
      { error: 'Project deletion is temporarily unavailable. Please try again later.', code: 'SOFT_DELETE_UNAVAILABLE' },
      { status: 503 },
    );
  }
  if (error) return serverError(error);
  return NextResponse.json({ ok: true, softDeleted: true, retentionDays: RETENTION_DAYS });
}
