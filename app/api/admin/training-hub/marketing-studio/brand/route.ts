import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadBrandPack } from '@/src/lib/marketing-studio/brand';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const brand = await loadBrandPack();
  return NextResponse.json({ brand });
}
