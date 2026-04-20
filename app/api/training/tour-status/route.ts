/**
 * Training Hub dashboard tour state endpoint.
 *
 * GET   — returns `{ completed: boolean }` for the current student.
 * POST  — body `{ completed?: boolean }`. `completed=true` marks the
 *         tour done (so it won't re-auto-start). `completed=false`
 *         resets it (used by "Restart Tour" from the profile menu).
 *
 * Auth: reads the `training_session` httpOnly cookie. No admin path —
 * tour state is per-student.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ completed: false, authenticated: false });

  const sb = getServerClient();
  const { data } = await sb
    .from('training_registrations_meta')
    .select('tour_completed')
    .eq('email', sess.email)
    .maybeSingle();

  return NextResponse.json({
    completed:     data?.tour_completed === true,
    authenticated: true,
  });
}

export async function POST(req: NextRequest) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { completed?: boolean };
  const completed = body.completed !== false;  // defaults to marking completed

  const sb = getServerClient();
  const { error } = await sb
    .from('training_registrations_meta')
    .update({ tour_completed: completed })
    .eq('email', sess.email);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, completed });
}
