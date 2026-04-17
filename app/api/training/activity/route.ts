import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

const BADGE_DEFS: { key: string; label: string; icon: string; check: (p: number, streak: number, perfect: boolean, speed: boolean) => boolean }[] = [
  { key: 'first_step',   label: 'First Step',      icon: '👣', check: (p) => p >= 1 },
  { key: 'on_fire',      label: 'On Fire',          icon: '🔥', check: (p) => p >= 3 },
  { key: 'unstoppable',  label: 'Unstoppable',      icon: '⚡', check: (_, s) => s >= 5 },
  { key: 'halfway',      label: 'Halfway There',    icon: '🎯', check: (p) => p >= 9 },
  { key: 'almost_there', label: 'Almost There',     icon: '🚀', check: (p) => p >= 15 },
  { key: 'certified',    label: 'Certified',        icon: '🏆', check: (p) => p >= 18 },
  { key: 'perfect_score',label: 'Perfect Score',    icon: '💯', check: (_, _s, perfect) => perfect },
  { key: 'speed_runner', label: 'Speed Runner',     icon: '⚡', check: (_, _s, _p, speed) => speed },
];

export async function POST(req: NextRequest) {
  try {
    const { registrationId, sessionsPassed, hasPerfect, isSpeedRunner } = await req.json() as {
      registrationId: string;
      sessionsPassed: number;
      hasPerfect?: boolean;
      isSpeedRunner?: boolean;
    };
    if (!registrationId) return NextResponse.json({ ok: false }, { status: 400 });

    const sb = getServerClient();
    const now = new Date();

    // Load existing profile
    const { data: existing } = await sb.from('student_profiles').select('last_active_at,streak_days,total_points').eq('registration_id', registrationId).maybeSingle();

    // Compute streak - compare calendar dates, not raw elapsed ms
    let streak = existing?.streak_days ?? 0;
    if (existing?.last_active_at) {
      // Strip time component so 11 PM → midnight counts as "next day"
      const todayDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const last      = new Date(existing.last_active_at);
      const lastDate  = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
      const diffDays  = Math.round((todayDate - lastDate) / 86400000);
      if (diffDays === 0) {
        // Same calendar day - no change
      } else if (diffDays === 1) {
        streak += 1;   // Consecutive day - extend streak
      } else {
        streak = 1;    // Gap of 2+ days - reset
      }
    } else {
      streak = 1;
    }

    // Points: 100 per session passed (new ones only)
    const existingPoints = existing?.total_points ?? 0;
    const expectedPoints = sessionsPassed * 100 + (hasPerfect ? 50 : 0) + (sessionsPassed >= 18 ? 1000 : sessionsPassed >= 9 ? 500 : 0);
    const newPoints = Math.max(existingPoints, expectedPoints);

    // Upsert profile
    await sb.from('student_profiles').upsert({
      registration_id: registrationId,
      last_active_at:  now.toISOString(),
      streak_days:     streak,
      total_points:    newPoints,
      updated_at:      now.toISOString(),
    }, { onConflict: 'registration_id' });

    // Compute & award badges
    const { data: earnedRows } = await sb.from('student_badges').select('badge_key').eq('registration_id', registrationId);
    const earned = new Set((earnedRows ?? []).map((r: { badge_key: string }) => r.badge_key));
    const newBadges: { registration_id: string; badge_key: string }[] = [];
    for (const def of BADGE_DEFS) {
      if (!earned.has(def.key) && def.check(sessionsPassed, streak, hasPerfect ?? false, isSpeedRunner ?? false)) {
        newBadges.push({ registration_id: registrationId, badge_key: def.key });
      }
    }
    if (newBadges.length > 0) {
      await sb.from('student_badges').insert(newBadges);
    }

    // Return updated state
    const { data: allBadges } = await sb.from('student_badges').select('badge_key,earned_at').eq('registration_id', registrationId);
    return NextResponse.json({ ok: true, streak, points: newPoints, badges: allBadges ?? [], newBadges: newBadges.map(b => b.badge_key) });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
