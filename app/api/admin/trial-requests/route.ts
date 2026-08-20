import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import { isUserLivePaddle, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';
import { sendTrialStartedEmail, sendTrialDeclinedEmail } from '@/src/shared/email/subscriptionEmails';

// Admin trial-request queue (used when "Trial requires approval" is on).
//   GET  -> pending requests joined with the requester's email/name/company/title.
//   POST -> { id, action: 'approve' | 'decline' }. Approve reuses the SHARED
//           setUserPlan(..., 'trial') (same path as every plan change), then
//           marks the row; decline just marks it. Tolerant if mig 173 is absent.

const PLATFORM = 'real-estate';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  // The qualification answers come from the USER row, not from a snapshot on
  // the request. `trial_requests` already duplicates company and job_title,
  // which is one answer stored twice; this does not extend that. One copy,
  // read through the existing join, so the card and the admin user record
  // cannot show different things.
  //
  // SCHEMA-TOLERANT, WIDEST FIRST, and the fallback matters here: this route
  // returns an EMPTY QUEUE on any error, so without the retry a database
  // without mig 216 would show "no pending requests" and an admin would
  // approve nothing while requests piled up. A missing column must cost the
  // two new fields, never the queue.
  const run = (cols: string) => sb
    .from('trial_requests')
    .select(cols)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  // DECLINED ROWS STAY VISIBLE (2026-08-20), in their own list, so a
  // decline is a decision an admin can revisit after speaking with the
  // user rather than a row that vanished. Newest first (the recent decline
  // is the one being reconsidered), capped so the queue view never pages.
  const runDeclined = (cols: string) => sb
    .from('trial_requests')
    .select(cols)
    .eq('status', 'declined')
    .order('decided_at', { ascending: false })
    .limit(25);

  // The contact block (phone / city / country) and the user's OWN created_at
  // sit in BOTH selects: those columns predate this work (migs 027 and 172), so
  // they cannot be what makes the wide select fail. Only the two mig-216
  // columns are in question, which is why the retry below tests for exactly
  // those two names and nothing else.
  //
  // `users(created_at)` is the REGISTRATION time. It is a different quantity
  // from the request's own created_at, which is when they asked for a trial.
  // Both are shown on the card and both are labelled, because "signed up three
  // weeks ago, asked today" and "signed up today, asked today" are different
  // requests.
  const CONTACT = 'email, name, phone, city, country, created_at';
  const NARROW = `id, user_id, status, company, job_title, created_at, users(${CONTACT})`;
  const WIDE = `id, user_id, status, company, job_title, created_at, users(${CONTACT}, works_in_real_estate, real_estate_role_note)`;

  let { data, error } = await run(WIDE);
  if (error && /works_in_real_estate|real_estate_role_note/.test(error.message)) {
    ({ data, error } = await run(NARROW));
  }
  // Table absent (mig 173 not applied) -> empty queue, never error the admin UI.
  if (error) return NextResponse.json({ requests: [], declined: [], migrationApplied: false });

  // The declined list is best effort: a failure here must not empty the
  // PENDING queue, which is the list approvals are waiting on.
  // decided_at is the DECLINE timestamp while the row is still declined (it
  // only comes to hold something else once the row is approved, at which
  // point it leaves this list). A mig-173 column, so safe in both ladders.
  let { data: declinedRows, error: dErr } = await runDeclined(`${WIDE}, decided_at`);
  if (dErr && /works_in_real_estate|real_estate_role_note/.test(dErr.message)) {
    ({ data: declinedRows, error: dErr } = await runDeclined(`${NARROW}, decided_at`));
  }
  return NextResponse.json({ requests: data ?? [], declined: dErr ? [] : (declinedRows ?? []), migrationApplied: true });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, action } = await req.json() as { id: string; action: 'approve' | 'decline' };
    if (!id || (action !== 'approve' && action !== 'decline')) {
      return NextResponse.json({ error: 'id and action (approve|decline) required' }, { status: 400 });
    }
    const sb = getServerClient();
    const adminId = (session.user as { id?: string }).id ?? null;

    const { data: reqRow, error: rErr } = await sb
      .from('trial_requests').select('id, user_id, status, decided_at, decided_by').eq('id', id).maybeSingle();
    if (rErr || !reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    const rowStatus = (reqRow as { status: string }).status;
    // APPROVE works on pending AND declined (2026-08-20): a decline is a
    // decision, not a dead end, and an admin who spoke with the user can
    // reverse it from the queue. DECLINE stays pending-only: declining an
    // approved trial is a plan change and belongs on the user record, and
    // re-declining a declined row is a no-op that would only re-date it.
    const allowed = action === 'approve' ? ['pending', 'declined'] : ['pending'];
    if (!allowed.includes(rowStatus)) {
      return NextResponse.json({ error: 'Request already decided' }, { status: 409 });
    }
    const targetUserId = (reqRow as { user_id: string }).user_id;

    if (action === 'approve') {
      // Block approving a trial for a Paddle-billed user (no silent divergence).
      if (await isUserLivePaddle(sb, targetUserId, PLATFORM)) {
        return NextResponse.json({ error: PADDLE_BILLED_BLOCK_MESSAGE, code: 'paddle_billed' }, { status: 409 });
      }
      // SAME shared plan-setting path as admin plan changes.
      const res = await setUserPlan(sb, targetUserId, 'trial', { platform: PLATFORM, adminId });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
      await sendTrialStartedEmail(sb, { userId: targetUserId, platform: PLATFORM, trialEndsAt: res.trialEndsAt ?? null });
    }

    // HISTORY IS PRESERVED, NOT OVERWRITTEN. decided_at / decided_by always
    // hold the LATEST decision; declined_at / declined_by (mig 218) hold the
    // decline forever. A decline stamps both pairs. An approval of a
    // declined row backfills declined_* from decided_* first (a row declined
    // before mig 218 carries its decline only there), then writes the
    // approval, so the record reads: declined by A at T1, approved by B at
    // T2. SCHEMA TOLERANT: without mig 218 the update retries without the
    // history columns and behaves exactly as before.
    const patch: Record<string, unknown> = {
      status: action === 'approve' ? 'approved' : 'declined',
      decided_at: new Date().toISOString(),
      decided_by: adminId,
    };
    if (action === 'decline') {
      patch.declined_at = patch.decided_at;
      patch.declined_by = adminId;
    } else if (rowStatus === 'declined') {
      const prev = reqRow as { decided_at?: string | null; decided_by?: string | null };
      patch.declined_at = prev.decided_at ?? null;
      patch.declined_by = prev.decided_by ?? null;
    }
    let { error: upErr } = await sb.from('trial_requests').update(patch).eq('id', id);
    if (upErr && /declined_at|declined_by/.test(upErr.message)) {
      delete patch.declined_at;
      delete patch.declined_by;
      ({ error: upErr } = await sb.from('trial_requests').update(patch).eq('id', id));
    }
    if (upErr) return NextResponse.json({ error: 'Failed to record the decision' }, { status: 500 });

    // The requester hears the outcome either way. Approval sends the trial
    // started email above; a decline now sends its own short neutral note,
    // AFTER the status update so the email never reports a decision that
    // failed to record. Never throws; deduped per request id.
    if (action === 'decline') {
      await sendTrialDeclinedEmail(sb, { userId: targetUserId, platform: PLATFORM, requestId: id });
    }

    return NextResponse.json({ ok: true, action });
  } catch {
    return NextResponse.json({ error: 'Failed to process trial request' }, { status: 500 });
  }
}
