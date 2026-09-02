/**
 * /api/refm/projects/[id]/lock
 *
 *   GET    -> who is editing this project, if anyone
 *   POST   -> acquire the lock, or refresh it if it is already mine
 *             body: { action?: 'acquire' | 'request-release' | 'decline' }
 *   DELETE -> release my lock (this is also how a holder ACCEPTS a request)
 *
 * ── ACQUIRE AND HEARTBEAT ARE THE SAME CALL ───────────────────────────────
 *
 * Deliberately. A separate heartbeat endpoint could succeed while the lock had
 * actually been stolen (after a network partition, say), and the holder would
 * keep editing against a lock they no longer own. Re-acquiring every beat means
 * the answer is always current: if someone took it, the next beat says so.
 *
 * ── ACCEPTING A REQUEST IS JUST RELEASING ─────────────────────────────────
 *
 * There is no `accept` action. Accepting IS releasing, and DELETE already does
 * that, so there is ONE way to give up a lock rather than two that could
 * diverge. Declining is its own action because it is genuinely different: the
 * request is cleared and the lock is kept.
 *
 * Reading the lock needs only READ access to the project, because seeing who is
 * editing is part of understanding what you are looking at. Taking it needs
 * `canSave`: a Viewer or Reviewer has no business holding an edit lock.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import {
  acquireLock, readLock, releaseLock, requestRelease, declineRelease,
  LOCK_TTL_SECONDS, LOCK_HEARTBEAT_SECONDS,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/lock';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { roleCan } from '@/src/core/collab/projectRoles';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

/** Read access to the project, plus the caller's role. */
async function reader(projectId: string) {
  const userId = await getRefmUserId();
  if (!userId) return { userId: null, role: null, res: unauthorized() };
  const { row, error, role } = await getProject(userId, projectId);
  if (error) return { userId, role: null, res: serverError(error) };
  if (!row) return { userId, role: null, res: notFound() };
  return { userId, role: role ?? null, res: null };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, res } = await reader(id);
  if (res) return res;

  const { lock, tableMissing, error } = await readLock(id, userId!);
  if (error) return serverError(error);
  return NextResponse.json({
    // A pre-233 database reports no locking rather than an error, so the UI
    // simply does not show a holder and editing behaves as it always did.
    lockingAvailable: !tableMissing,
    lock,
    ttlSeconds: LOCK_TTL_SECONDS,
    heartbeatSeconds: LOCK_HEARTBEAT_SECONDS,
  });
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, role, res } = await reader(id);
  if (res) return res;

  // THE UNLOAD BEACON. navigator.sendBeacon can only POST, so a release sent
  // on unload arrives here rather than at DELETE. Without this branch it would
  // fall through to the default action and REFRESH the lock, which is worse
  // than having no beacon at all: leaving a page would extend the lock.
  if (new URL(req.url).searchParams.get('release') === '1') {
    const { released, error } = await releaseLock(id, userId!);
    if (error) return serverError(error);
    return NextResponse.json({ released });
  }

  let body: { action?: string } = {};
  try { body = (await req.json()) as { action?: string }; } catch { /* an empty body means acquire */ }
  const action = body.action ?? 'acquire';

  if (action === 'request-release') {
    // Anyone who can READ may ask, because asking is not editing. Whether the
    // asker could actually use the lock is checked when they try to take it.
    const { requested, error } = await requestRelease(id, userId!);
    if (error) return serverError(error);
    const after = await readLock(id, userId!);
    return NextResponse.json({ requested, lock: after.lock });
  }

  if (action === 'decline') {
    const { declined, error } = await declineRelease(id, userId!);
    if (error) return serverError(error);
    const after = await readLock(id, userId!);
    return NextResponse.json({ declined, lock: after.lock });
  }

  if (action !== 'acquire') return badRequest(`Unknown action "${action}".`);

  // Taking the lock needs the ability to save. A null role is the pre-231
  // "reached as owner" case and holds everything.
  if (role !== null && !roleCan(role, 'canSave')) {
    return NextResponse.json(
      { error: 'Your role on this project is read-only, so you cannot start editing.', code: 'ROLE_READ_ONLY' },
      { status: 403 },
    );
  }

  const { lock, tableMissing, error } = await acquireLock(id, userId!);
  if (error) return serverError(error);
  if (tableMissing) {
    // Nothing to lock, and nothing to refuse. Pre-233 behaviour.
    return NextResponse.json({ lockingAvailable: false, acquired: true, lock: null });
  }
  if (!lock) {
    // Someone else holds a LIVE lock. 409, naming them, because "someone else
    // is editing" is actionable and a bare refusal is not.
    const current = await readLock(id, userId!);
    return NextResponse.json(
      {
        error: current.lock?.holderName
          ? `${current.lock.holderName} is editing this project.`
          : 'Someone else is editing this project.',
        code: 'LOCKED_BY_OTHER',
        lock: current.lock,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ lockingAvailable: true, acquired: true, lock });
}

// ── DELETE ──────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, res } = await reader(id);
  if (res) return res;

  const { released, error } = await releaseLock(id, userId!);
  if (error) return serverError(error);
  // `released: false` is not an error: it means the caller did not hold it,
  // which is the normal outcome of a duplicate release or a lock that had
  // already aged out.
  return NextResponse.json({ released });
}
