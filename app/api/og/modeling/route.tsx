import { ImageResponse } from 'next/og';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';

/** GET /api/og/modeling — Modeling Hub OG banner (app.financialmodelerpro.com) */
export async function GET() {
  const [content, sections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('modeling'),
  ]);
  const heroRaw = sections.find(s => s.section_type === 'hero');
  const h = heroRaw?.visible !== false ? heroRaw?.content as Record<string, unknown> | undefined : undefined;

  const badge    = (h?.badge as string)    || cms(content, 'modeling_hub', 'hero_badge',    '📐 Professional Modeling Platform');
  const headline = ((h?.headline as string) || cms(content, 'modeling_hub', 'hero_headline', 'Build Institutional-Grade\nFinancial Models')).replace(/\n/g, ' ');
  const sub      = (h?.subtitle as string) || cms(content, 'modeling_hub', 'hero_sub',      'Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more.');

  return new ImageResponse(
    (
      <div style={{
        width: 1200, height: 627, display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 80px', position: 'relative' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>FMP</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#ffffff' }}>Financial Modeler Pro</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>Modeling Hub</span>
            </div>
          </div>

          {/* Badge — blue */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px', borderRadius: 24, background: 'rgba(27,79,138,0.18)', border: '1px solid rgba(27,79,138,0.45)', marginBottom: 32 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#93C5FD' }}>{badge}</span>
          </div>

          {/* Headline */}
          <div style={{ fontSize: 56, fontWeight: 800, color: '#ffffff', lineHeight: 1.12, marginBottom: 24, maxWidth: 820, textAlign: 'center', letterSpacing: '-0.02em' }}>
            {headline}
          </div>

          {/* Subline */}
          <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: 700, textAlign: 'center' }}>
            {sub}
          </div>
        </div>

        <div style={{ padding: '20px 48px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>app.financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 627 },
  );
}
