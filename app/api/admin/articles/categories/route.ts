import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

/* ── GET /api/admin/articles/categories ───
   Distinct category values already used across articles, so the admin combobox
   can offer existing categories as suggestions while still accepting a brand-new
   one typed by hand (category is free text, no enum). Admin-gated. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = getServerClient();
  const { data, error } = await sb.from('articles').select('category');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seen = new Set<string>();
  const categories: string[] = [];
  for (const row of data ?? []) {
    const c = (row as { category?: string | null }).category?.trim();
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); categories.push(c); }
  }
  categories.sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ categories });
}
