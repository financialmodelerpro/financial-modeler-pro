import { ImageResponse } from 'next/og';

/**
 * GET /api/og — Branded 1200x627 OG banner for LinkedIn/Facebook/Twitter.
 * Used as the default og:image across all domains.
 */
export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0D2E5A', fontFamily: 'Arial, sans-serif', position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(145deg, #1F3864 0%, #1B4F8A 45%, #2E75B6 100%)', display: 'flex' }} />
        {/* Decorative elements */}
        <div style={{ position: 'absolute', top: -100, right: -100, width: 400, height: 400, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -80, left: -80, width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: 180, right: 200, width: 140, height: 140, borderRadius: '50%', background: 'rgba(46,170,74,0.06)', display: 'flex' }} />

        {/* Main content — centered */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, padding: '0 80px', position: 'relative', textAlign: 'center',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, background: '#2EAA4A',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px',
            }}>FMP</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#ffffff', letterSpacing: '0.3px' }}>Financial Modeler Pro</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>Professional Certification</span>
            </div>
          </div>

          {/* Headline */}
          <div style={{ fontSize: 48, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, marginBottom: 16, maxWidth: 800 }}>
            Free Financial Modeling Certification
          </div>

          {/* Subline */}
          <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, maxWidth: 700, marginBottom: 36 }}>
            Build institutional-grade financial models with 3-Statement Financial Modeling and Business Valuation courses
          </div>

          {/* CTA badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 28px', borderRadius: 10,
            background: 'rgba(46,170,74,0.15)', border: '1px solid rgba(46,170,74,0.3)',
          }}>
            <span style={{ fontSize: 20 }}>🎓</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.5px' }}>Start Free — No Credit Card Required</span>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: '18px 48px', position: 'relative',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.5px' }}>learn.financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 627 },
  );
}
