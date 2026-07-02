import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { writeAuditLog } from '@/src/shared/audit';
import { resolveLapseAnchorMs, computeLapseState, type LapseState } from '@/src/shared/entitlements/gate';
import { syncPlatformSubscriptionFields } from '@/src/shared/payments/config';

// ── Admin guard ───────────────────────────────────────────────────────────────
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, session: null };
  if ((session.user as { role?: string }).role !== 'admin') {
    return { error: 'Forbidden', status: 403, session: null };
  }
  return { error: null, status: 200, session };
}

// ── GET: paginated user list ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  try {
    const { searchParams } = req.nextUrl;
    const page   = parseInt(searchParams.get('page') ?? '0');
    const size   = parseInt(searchParams.get('size') ?? '20');
    const search = searchParams.get('search') ?? '';
    const role   = searchParams.get('role')   ?? '';
    // Cancellation filter (retention outreach): 'canceling' = a cancel is scheduled
    // and access has not ended yet; 'canceled' = a scheduled cancel whose date has
    // passed. Both read the durable scheduled_cancel_at marker (mig 183).
    const cancel = searchParams.get('cancel') ?? '';

    const sb = getServerClient();
    const nowMs = Date.now();

    // When filtering by cancel state, resolve the matching user ids from the
    // durable marker FIRST, then constrain the paginated users query to them. Own
    // try/catch so a pre-mig-183 DB simply yields no matches (feature dark until
    // applied) without breaking the list. An empty match set short-circuits below.
    let restrictIds: string[] | null = null;
    if (cancel === 'canceling' || cancel === 'canceled') {
      restrictIds = [];
      try {
        const { data: cRows } = await sb
          .from('user_platform_subscriptions')
          .select('user_id, scheduled_cancel_at')
          .eq('platform_slug', 'real-estate')
          .not('scheduled_cancel_at', 'is', null);
        for (const r of (cRows ?? []) as Array<{ user_id: string; scheduled_cancel_at: string | null }>) {
          const endMs = r.scheduled_cancel_at ? Date.parse(r.scheduled_cancel_at) : NaN;
          if (Number.isNaN(endMs)) continue;
          const isCanceled = nowMs >= endMs;
          if ((cancel === 'canceled') === isCanceled) restrictIds.push(r.user_id);
        }
      } catch {
        // column absent pre mig 183: no matches.
      }
    }

    // company / job_title are mig 172, trial_ends_at gives the trial expiry anchor.
    // Select them when present; fall back to the base columns if a migration is
    // not applied yet (never break the list).
    const BASE = 'id, email, name, role, subscription_plan, subscription_status, created_at, trial_ends_at, projects(count)';
    const runQuery = async (cols: string) => {
      let q = sb.from('users').select(cols, { count: 'exact' });
      if (search) q = q.ilike('email', `%${search}%`);
      if (role && role !== 'all') q = q.eq('role', role);
      if (restrictIds !== null) q = q.in('id', restrictIds.length ? restrictIds : ['00000000-0000-0000-0000-000000000000']);
      q = q.order('created_at', { ascending: false }).range(page * size, (page + 1) * size - 1);
      return q;
    };

    let { data, count, error: dbError } = await runQuery(`${BASE}, company, job_title`);
    if (dbError && /company|job_title/.test(dbError.message)) {
      ({ data, count, error: dbError } = await runQuery(BASE));
    }
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    // Decorate each user with the access-expiry anchor + auto-computed lapse
    // state (active / grace / lapsed), so the admin list shows who is expiring,
    // when, and the live status by DATE (independent of any stored status / cron).
    // The lapse model is identical to the live gate (shared pure helpers), so the
    // column and the user's actual access never diverge. Schema-tolerant: a
    // pre-migration DB (no subscription rows) simply shows no expiry.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const ids = rows.map((r) => r.id as string).filter(Boolean);
    let subsByUser = new Map<string, { expires_at?: string | null; current_period_end?: string | null; status?: string | null }>();
    try {
      if (ids.length) {
        const { data: subs } = await sb
          .from('user_platform_subscriptions')
          .select('user_id, expires_at, current_period_end, status')
          .eq('platform_slug', 'real-estate')
          .in('user_id', ids);
        subsByUser = new Map(
          ((subs ?? []) as Array<{ user_id: string; expires_at?: string | null; current_period_end?: string | null; status?: string | null }>)
            .map((s) => [s.user_id, s]),
        );
      }
    } catch {
      // table absent pre-migration: leave subsByUser empty (no expiry shown).
    }

    // The cancel-at-period-end marker (mig 183), read in its OWN query so a
    // pre-mig-183 DB does not break the subs read above (all-or-nothing select).
    const cancelByUser = new Map<string, string>(); // user_id -> scheduled_cancel_at ISO
    try {
      if (ids.length) {
        const { data: cRows } = await sb
          .from('user_platform_subscriptions')
          .select('user_id, scheduled_cancel_at')
          .eq('platform_slug', 'real-estate')
          .in('user_id', ids)
          .not('scheduled_cancel_at', 'is', null);
        for (const c of (cRows ?? []) as Array<{ user_id: string; scheduled_cancel_at: string | null }>) {
          if (c.scheduled_cancel_at) cancelByUser.set(c.user_id, c.scheduled_cancel_at);
        }
      }
    } catch {
      // column absent pre mig 183: no cancel markers shown.
    }

    const users = rows.map((u) => {
      const planKey = (u.subscription_plan as string) ?? '';
      const trialEndsAt = (u.trial_ends_at as string | null) ?? null;
      const sub = subsByUser.get(u.id as string);
      const anchorMs = resolveLapseAnchorMs({
        planKey,
        trialEndsAtMs: trialEndsAt ? Date.parse(trialEndsAt) : null,
        subExpiresAtMs: sub?.expires_at ? Date.parse(sub.expires_at) : null,
        subPeriodEndMs: sub?.current_period_end ? Date.parse(sub.current_period_end) : null,
        subStatus: sub?.status ?? null,
      });
      const { state } = computeLapseState(anchorMs, nowMs);
      const accessExpiresAt = anchorMs != null ? new Date(anchorMs).toISOString() : null;
      // The admin display status: the date-driven lapse state when the plan has an
      // expiry, otherwise the stored subscription_status.
      const accessStatus: LapseState | string = anchorMs != null ? state : (u.subscription_status as string) ?? 'active';
      // Cancellation state from the durable marker: 'canceling' while access has
      // not ended, 'canceled' once the scheduled date has passed, else null. Shown
      // as its own badge + end date so a canceled user is never plain "active".
      const cancelAt = cancelByUser.get(u.id as string) ?? null;
      const cancelAtMs = cancelAt ? Date.parse(cancelAt) : NaN;
      const cancelState: 'canceling' | 'canceled' | null = Number.isNaN(cancelAtMs)
        ? null
        : (nowMs >= cancelAtMs ? 'canceled' : 'canceling');
      return { ...u, accessExpiresAt, lapseState: anchorMs != null ? state : 'active', accessStatus, cancelState, cancelAt };
    });

    return NextResponse.json({ users, total: count ?? 0 });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// ── PATCH: update role, subscription_plan, and/or subscription_status ────────
export async function PATCH(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  try {
    const body = await req.json() as {
      id:      string;
      role?:   string;
      status?: string;
      reason?: string;
    };

    const { id, role, status: newStatus, reason } = body;
    if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    // Plan changes do NOT go through this route. The single shared plan-setting
    // path is POST /api/admin/entitlements/user/plan (setUserPlan), used by both
    // /admin/users and /admin/access. This route only handles role + status.
    if (!role && !newStatus) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminId = (session.user as { id: string }).id;
    const sb = getServerClient();

    // Fetch current values so we can record before_value in audit log
    const { data: current, error: fetchError } = await sb
      .from('users')
      .select('role, subscription_plan, subscription_status')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build update payload (plan intentionally excluded; see note above).
    const updates: Record<string, string> = {};
    if (role)      updates.role                = role;
    if (newStatus) updates.subscription_status = newStatus;

    const { error: updateError } = await sb.from('users').update(updates).eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    // Converge store B status when the admin changes the status here, but ONLY for
    // a manual-source row: this closes the status-only seam (store A status was
    // written without B) without ever overwriting webhook-owned Paddle status.
    // Plan is not written by this route, so only status is synced.
    if (newStatus) {
      await syncPlatformSubscriptionFields(sb, id, 'real-estate', { status: newStatus }, { manualOnly: true });
    }

    // Write audit log entries - one per changed field
    const auditBase = { adminId, targetUserId: id, reason: reason ?? null };

    if (role) {
      await writeAuditLog({
        ...auditBase,
        action:      'role_change',
        beforeValue: { role: current.role },
        afterValue:  { role },
      });
    }

    if (newStatus) {
      await writeAuditLog({
        ...auditBase,
        action:      'status_change',
        beforeValue: { status: current.subscription_status },
        afterValue:  { status: newStatus },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
