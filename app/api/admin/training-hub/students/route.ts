import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getStudentRoster } from '@/src/hubs/training/lib/appsScript/studentRoster';
import { getServerClient } from '@/src/core/db/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const [students, blocksRes] = await Promise.all([
    getStudentRoster(),
    sb.from('training_admin_actions')
      .select('id, registration_id')
      .eq('action_type', 'block')
      .eq('is_active', true),
  ]);

  const blocks = blocksRes.data ?? [];
  const blockMap = new Map(blocks.map(b => [b.registration_id as string, b.id as string]));

  const out = students.map(s => ({
    ...s,
    isBlocked:     blockMap.has(s.registrationId),
    blockActionId: blockMap.get(s.registrationId) ?? null,
  }));

  return NextResponse.json({
    students:             out,
    dataAvailable:        true,
    appsScriptConfigured: true,
    error:                null,
  });
}
