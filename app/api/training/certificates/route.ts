import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';

interface CourseRef {
  id: string;
  title: string;
  slug: string;
}

interface CertificateRow {
  certificate_number: string;
  issued_at: string;
  courses: CourseRef;
}

const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from('users')
    .select('id, full_name')
    .eq('email', session.user.email)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ certificates: [], userName: '' });
  }

  const { data, error } = await sb
    .from('certificates')
    .select('certificate_number, issued_at, courses(id, title, slug)')
    .eq('user_id', user.id)
    .order('issued_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    certificates: (data ?? []) as unknown as CertificateRow[],
    userName: user.full_name ?? '',
  });
}
