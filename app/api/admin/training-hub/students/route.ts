import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { listAllStudents } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [studentsRes, sb] = [await listAllStudents(), getServerClient()];

  const { data: blocks } = await sb
    .from('training_admin_actions')
    .select('id, registration_id')
    .eq('action_type', 'block')
    .eq('is_active', true);

  const blockMap = new Map((blocks ?? []).map(b => [b.registration_id, b.id as string]));

  const students = (studentsRes.data ?? []).map(s => ({
    ...s,
    isBlocked:     blockMap.has(s.registrationId),
    blockActionId: blockMap.get(s.registrationId) ?? null,
  }));

  return NextResponse.json({
    students,
    dataAvailable: studentsRes.success,
    appsScriptConfigured: studentsRes.error !== 'APPS_SCRIPT_URL not configured',
    error: studentsRes.success ? null : studentsRes.error,
  });
}
