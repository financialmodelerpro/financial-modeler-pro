import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { INTRO_SETTING_KEY } from '@/src/hubs/main/components/intro/introScope';
import { readIntroEnabled, invalidateIntroSetting } from '@/src/hubs/main/components/intro/introSetting';

/** Admin switch for the main-site logo intro (training_settings `site_intro_animation`; absent = On). */
async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!session?.user && (session.user as { role?: string }).role === 'admin';
}

export async function GET() {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ enabled: await readIntroEnabled() }); }
  catch { return NextResponse.json({ error: 'Failed to read' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  const { error } = await getServerClient().from('training_settings').upsert({ key: INTRO_SETTING_KEY, value: body.enabled ? 'true' : 'false' }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateIntroSetting();
  return NextResponse.json({ ok: true, enabled: await readIntroEnabled() });
}
