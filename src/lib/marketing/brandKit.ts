import { getServerClient } from '@/src/lib/shared/supabase';
import { DEFAULT_BRAND_KIT, type BrandKit, type ImageAsset } from './types';

function toImageAssetArray(v: unknown): ImageAsset[] {
  if (!Array.isArray(v)) return [];
  return v.filter(x => x && typeof x === 'object').map((x) => {
    const rec = x as Record<string, unknown>;
    return { url: String(rec.url ?? ''), name: String(rec.name ?? '') };
  }).filter(x => x.url);
}

/** Load the singleton brand kit row (id=1). Falls back to defaults. */
export async function loadBrandKit(): Promise<BrandKit> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('marketing_brand_kit').select('*').eq('id', 1).maybeSingle();
    if (!data) return { ...DEFAULT_BRAND_KIT };
    return {
      logo_url:          data.logo_url         ?? DEFAULT_BRAND_KIT.logo_url,
      logo_light_url:    data.logo_light_url   ?? DEFAULT_BRAND_KIT.logo_light_url,
      founder_photo_url: data.founder_photo_url ?? DEFAULT_BRAND_KIT.founder_photo_url,
      primary_color:     data.primary_color    ?? DEFAULT_BRAND_KIT.primary_color,
      secondary_color:   data.secondary_color  ?? DEFAULT_BRAND_KIT.secondary_color,
      accent_color:      data.accent_color     ?? DEFAULT_BRAND_KIT.accent_color,
      text_color_dark:   data.text_color_dark  ?? DEFAULT_BRAND_KIT.text_color_dark,
      text_color_light:  data.text_color_light ?? DEFAULT_BRAND_KIT.text_color_light,
      font_family:       data.font_family      ?? DEFAULT_BRAND_KIT.font_family,
      additional_logos:  toImageAssetArray(data.additional_logos),
      additional_photos: toImageAssetArray(data.additional_photos),
      uploaded_images:   toImageAssetArray(data.uploaded_images),
    };
  } catch {
    return { ...DEFAULT_BRAND_KIT };
  }
}
