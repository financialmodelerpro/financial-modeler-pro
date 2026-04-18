import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { loadBrandKit } from '@/src/lib/marketing/brandKit';

export const runtime = 'nodejs';

/** GET /api/admin/marketing-studio/brand-kit — returns current brand kit row */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const brandKit = await loadBrandKit();
  return NextResponse.json({ brandKit });
}

const ALLOWED_KEYS = new Set([
  'logo_url', 'logo_light_url', 'founder_photo_url',
  'primary_color', 'secondary_color', 'accent_color',
  'text_color_dark', 'text_color_light', 'font_family',
  'additional_logos', 'additional_photos', 'uploaded_images',
]);

/** PATCH /api/admin/marketing-studio/brand-kit — update brand kit row (singleton id=1) */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_KEYS.has(k)) patch[k] = v;
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('marketing_brand_kit')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brandKit: data });
}
