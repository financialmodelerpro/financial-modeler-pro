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
  if (error) return NextResponse.json({ requests: [], migrationApplied: false });
  return NextResponse.json({ requests: data ?? [], migrationApplied: true });
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
      .from('trial_requests').select('id, user_id, status').eq('id', id).maybeSingle();
    if (rErr || !reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if ((reqRow as { status: string }).status !== 'pending') {
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

    await sb.from('trial_requests').update({
      status: action === 'approve' ? 'approved' : 'declined',
      decided_at: new Date().toISOString(),
      decided_by: adminId,
    }).eq('id', id);

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
