import { ImageResponse } from 'next/og';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';

/** GET /api/og/main — Main site OG banner (financialmodelerpro.com) */
export async function GET() {
  // Fetch hero content from CMS — same source as app/(portal)/page.tsx
  const [content, sections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('home'),
  ]);
  const heroRaw = sections.find(s => s.section_type === 'hero');
  const h = heroRaw?.visible !== false ? heroRaw?.content as Record<string, unknown> | undefined : undefined;

  const badge    = (h?.badge as string)    || cms(content, 'hero', 'badge_text',  '🚀 Now Live — Free to Use');
  const headline = (h?.headline as string) || cms(content, 'hero', 'headline',    'Build Institutional-Grade Financial Models — Without Starting From Scratch');
  const sub      = (h?.subtitle as string) || cms(content, 'hero', 'subheadline', 'Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals.');

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)',
        fontFamily: 'Arial, sans-serif', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(45,107,168,0.25) 0%, transparent 65%)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 80px', position: 'relative', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 36 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#fff' }}>FMP</div>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#ffffff' }}>Financial Modeler Pro</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 20px', borderRadius: 20, background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)', marginBottom: 28 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#6EE589', letterSpacing: '0.04em' }}>{badge}</span>
          </div>

          <div style={{ fontSize: 48, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, marginBottom: 20, maxWidth: 860, letterSpacing: '-0.02em' }}>
            {headline}
          </div>

          <div style={{ fontSize: 19, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, maxWidth: 700 }}>
            {sub}
          </div>
        </div>

        <div style={{ padding: '18px 48px', position: 'relative', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)' }}>financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 627 },
  );
}
