import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/registered-name
 *
 * The signed student's full name as registered (training_registrations_meta,
 * the name on their certificate). The Join live button shows it before opening
 * Teams, so a guest types the same name and the attendance sync can match it
 * (liveCourse/nameMatch.ts). Only ever the caller's own name.
 */
export async function GET() {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data } = await getServerClient().from('training_registrations_meta').select('name').eq('email', sess.email.toLowerCase()).maybeSingle();
  return NextResponse.json({ name: ((data?.name as string | null) ?? '').trim() });
}
