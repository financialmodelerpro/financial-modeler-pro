import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { testTeamsConnection, isTeamsConfigured } from '@/src/integrations/teams/teamsMeetings';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  const configured = isTeamsConfigured();
  const result     = await testTeamsConnection();
  return NextResponse.json({ configured, ...result });
}
