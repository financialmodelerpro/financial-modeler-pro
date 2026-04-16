import { ImageResponse } from 'next/og';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';
import sharp from 'sharp';

export const runtime = 'nodejs';

async function fetchAsBase64(url: string, label: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    console.log(`[og/main] ${label} fetch: status=${res.status}`);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 50) return '';
    const ct = res.headers.get('content-type') || '';
    const isSvg = ct.includes('svg') || ct.includes('xml') || url.toLowerCase().endsWith('.svg');
    if (isSvg) {
      try {
        const pngBuf = await sharp(buf).resize({ height: 200 }).png().toBuffer();
        return `data:image/png;base64,${pngBuf.toString('base64')}`;
      } catch {
        return `data:image/svg+xml;base64,${buf.toString('base64')}`;
      }
    }
    const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

/** GET /api/og/main — Main site OG banner */
export async function GET() {
  const [content, sections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('home'),
  ]);
  const heroRaw = sections.find(s => s.section_type === 'hero');
  const h = heroRaw?.visible !== false ? heroRaw?.content as Record<string, unknown> | undefined : undefined;

  const badge    = (h?.badge as string)    || cms(content, 'hero', 'badge_text',  '🚀 Now Live — Free to Use');
  const headline = (h?.headline as string) || cms(content, 'hero', 'headline',    'Build Institutional-Grade Financial Models — Without Starting From Scratch');
  const sub      = (h?.subtitle as string) || cms(content, 'hero', 'subheadline', 'Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals.');

  let logoDataUri = '';
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
    if (logoEnabled && logoUrl) logoDataUri = await fetchAsBase64(logoUrl, 'logo');
  } catch { /* skip */ }

  return new ImageResponse(
    (
      <div style={{
        width: 2400, height: 1254, display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(45,107,168,0.25) 0%, transparent 65%)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: -160, right: -160, width: 720, height: 720, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 160px', position: 'relative' }}>
          {logoDataUri && (
            <div style={{ display: 'flex', marginBottom: 80 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoDataUri} alt="FMP" style={{ height: 104 }} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 48px', borderRadius: 48, background: 'rgba(46,170,74,0.18)', border: '2px solid rgba(46,170,74,0.45)', marginBottom: 64 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#6EE589' }}>{badge}</span>
          </div>

          <div style={{ fontSize: 100, fontWeight: 800, color: '#ffffff', lineHeight: 1.12, marginBottom: 48, maxWidth: 1760, textAlign: 'center', letterSpacing: '-0.02em' }}>
            {headline}
          </div>

          <div style={{ fontSize: 40, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: 1440, textAlign: 'center' }}>
            {sub}
          </div>
        </div>

        <div style={{ padding: '40px 96px', borderTop: '2px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 32, color: 'rgba(255,255,255,0.3)' }}>financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 2400, height: 1254 },
  );
}
