import { ImageResponse } from 'next/og';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';
import sharp from 'sharp';

export const runtime = 'nodejs';

async function fetchAsBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 50) return '';
    const ct = res.headers.get('content-type') || '';
    const isSvg = ct.includes('svg') || ct.includes('xml') || url.toLowerCase().endsWith('.svg');
    if (isSvg) {
      try { return `data:image/png;base64,${(await sharp(buf).resize({ height: 200 }).png().toBuffer()).toString('base64')}`; }
      catch { return `data:image/svg+xml;base64,${buf.toString('base64')}`; }
    }
    const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

async function fetchLogo(): Promise<string> {
  try {
    const sb = getServerClient();
    const { data: rows } = await sb
      .from('cms_content')
      .select('section, key, value')
      .in('section', ['header_settings', 'branding', 'platform'])
      .in('key', ['logo_url', 'logo_enabled']);
    const map: Record<string, string> = {};
    for (const r of (rows ?? []) as { section: string; key: string; value: string }[]) map[`${r.section}__${r.key}`] = r.value;
    const logoUrl = map['header_settings__logo_url'] || map['branding__logo_url'] || map['platform__logo_url'] || '';
    const logoEnabled = map['header_settings__logo_enabled'] !== 'false';
    if (logoEnabled && logoUrl) return await fetchAsBase64(logoUrl);
  } catch { /* skip */ }
  return '';
}

/** GET /api/og — Training Hub OG banner */
export async function GET() {
  // All fetches wrapped — route always returns a valid image
  const [content, sections, logoDataUri] = await Promise.all([
    getCmsContent().catch(() => ({} as Record<string, Record<string, string>>)),
    getAllPageSections('training').catch(() => []),
    fetchLogo().catch(() => ''),
  ]);
  const heroRaw = sections.find(s => s.section_type === 'hero');
  const h = heroRaw?.visible !== false ? heroRaw?.content as Record<string, unknown> | undefined : undefined;

  const badge    = (h?.badge as string)    || cms(content, 'training_page', 'hero_badge',    '🎓 Free Certification Program');
  const headline = (h?.headline as string) || cms(content, 'training_page', 'hero_headline', 'Get Certified in Financial Modeling — Free');
  const sub      = (h?.subtitle as string) || cms(content, 'training_page', 'hero_sub',      'Professional certification backed by real practitioner training. 100% free. Always.');

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)', fontFamily: 'Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 80px', position: 'relative' }}>
          {logoDataUri ? (
            <div style={{ display: 'flex', marginBottom: 36 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoDataUri} alt="FMP" style={{ height: 56 }} />
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 22px', borderRadius: 22, background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)', marginBottom: 28 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#6EE589' }}>{badge}</span>
          </div>

          <div style={{ fontSize: 54, fontWeight: 800, color: '#ffffff', lineHeight: 1.1, marginBottom: 20, maxWidth: 820, textAlign: 'center', letterSpacing: '-0.02em' }}>
            {headline}
          </div>

          <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, maxWidth: 660, textAlign: 'center' }}>
            {sub}
          </div>
        </div>

        <div style={{ padding: '18px 48px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>learn.financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
