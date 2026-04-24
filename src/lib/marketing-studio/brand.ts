import { getServerClient } from '@/src/lib/shared/supabase';
import type { BrandPack, Instructor } from './types';

const FALLBACK: BrandPack = {
  logoUrl: '',
  primaryColor: '#0D2E5A',
  trainer: {
    id: '',
    name: 'Ahmad Din',
    title: 'Corporate Finance & Transaction Advisory Specialist',
    photoUrl: '',
    credentials: '',
  },
};

export async function loadBrandPack(): Promise<BrandPack> {
  const sb = getServerClient();

  const [logoRow, brandRow, trainerRow] = await Promise.all([
    sb.from('cms_content')
      .select('value')
      .eq('section', 'header_settings')
      .eq('key', 'logo_url')
      .maybeSingle(),
    sb.from('email_branding')
      .select('primary_color')
      .limit(1)
      .maybeSingle(),
    sb.from('instructors')
      .select('name, title, photo_url, credentials')
      .eq('is_default', true)
      .eq('active', true)
      .maybeSingle(),
  ]);

  const logoUrl     = (logoRow.data?.value as string | undefined) ?? FALLBACK.logoUrl;
  const primaryColor = (brandRow.data?.primary_color as string | undefined) ?? FALLBACK.primaryColor;
  const trainerData = trainerRow.data;

  return {
    logoUrl,
    primaryColor,
    trainer: trainerData ? {
      id: '',
      name: trainerData.name ?? FALLBACK.trainer.name,
      title: trainerData.title ?? FALLBACK.trainer.title,
      photoUrl: trainerData.photo_url ?? '',
      credentials: trainerData.credentials ?? '',
    } : FALLBACK.trainer,
  };
}

/**
 * Fetch the chosen instructors by id, preserving the order the admin picked
 * them in. Inactive rows are excluded so a deactivated instructor silently
 * drops off the banner.
 */
export async function loadInstructorsByIds(ids: string[]): Promise<Instructor[]> {
  const trimmed = ids.filter(Boolean);
  if (trimmed.length === 0) return [];
  const sb = getServerClient();
  const { data } = await sb
    .from('instructors')
    .select('id, name, title, photo_url, credentials, active')
    .in('id', trimmed)
    .eq('active', true);
  const byId = new Map<string, Instructor>();
  for (const row of (data ?? []) as Array<{
    id: string; name: string; title: string; photo_url: string | null; credentials: string | null;
  }>) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      title: row.title,
      photoUrl: row.photo_url ?? '',
      credentials: row.credentials ?? '',
    });
  }
  // Preserve admin pick order
  const out: Instructor[] = [];
  for (const id of trimmed) {
    const ins = byId.get(id);
    if (ins) out.push(ins);
  }
  return out;
}
