import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { DEVICE_VERIFICATION_SETTING_KEY } from '@/src/shared/auth/deviceTrust';

/**
 * Admin switch for new-device verification (the emailed one-time code), stored
 * in training_settings under DEVICE_VERIFICATION_SETTING_KEY as 'true'/'false'.
 * `enabled` here means "verification is REQUIRED". Defaults to true (required)
 * when the row is absent, matching isDeviceVerificationRequired().
 */
async function readEnabled(): Promise<boolean> {
  const sb = getServerClient();
  const { data } = await sb
    .from('training_settings')
    .select('value')
    .eq('key', DEVICE_VERIFICATION_SETTING_KEY)
    .maybeSingle();
  return (data?.value ?? 'true') !== 'false';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ enabled: await readEnabled() });
  } catch {
    // Fail-secure: on a read error report REQUIRED so nothing silently drops the
    // device check. (Sign-in enforcement reads the DB directly via
    // isDeviceVerificationRequired, independent of this admin endpoint.)
    return NextResponse.json({ enabled: true });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json() as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
    }
    const sb = getServerClient();
    const { error } = await sb
      .from('training_settings')
      .upsert({ key: DEVICE_VERIFICATION_SETTING_KEY, value: body.enabled ? 'true' : 'false' }, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, enabled: await readEnabled() });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
