import { getServerClient } from '@/src/lib/shared/supabase';
import type { BrandPack } from './types';

const FALLBACK: BrandPack = {
  logoUrl: '',
  primaryColor: '#0D2E5A',
  trainer: {
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
      name: trainerData.name ?? FALLBACK.trainer.name,
      title: trainerData.title ?? FALLBACK.trainer.title,
      photoUrl: trainerData.photo_url ?? '',
      credentials: trainerData.credentials ?? '',
    } : FALLBACK.trainer,
  };
}
