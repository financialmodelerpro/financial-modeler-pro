import { ImageResponse } from 'next/og';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';

/** GET /api/og/main — Main site OG banner (financialmodelerpro.com) */
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

  return new ImageResponse(
    (
      <div style={{
        width: 1200, height: 627, display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(45,107,168,0.25) 0%, transparent 65%)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 80px', position: 'relative' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>FMP</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#ffffff' }}>Financial Modeler Pro</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>Platform Hub</span>
            </div>
          </div>

          {/* Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px', borderRadius: 24, background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)', marginBottom: 32 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#6EE589' }}>{badge}</span>
          </div>

          {/* Headline */}
          <div style={{ fontSize: 50, fontWeight: 800, color: '#ffffff', lineHeight: 1.12, marginBottom: 24, maxWidth: 880, textAlign: 'center', letterSpacing: '-0.02em' }}>
            {headline}
          </div>

          {/* Subline */}
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: 720, textAlign: 'center' }}>
            {sub}
          </div>
        </div>

        <div style={{ padding: '20px 48px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 627 },
  );
}
