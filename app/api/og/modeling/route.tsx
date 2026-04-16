import { ImageResponse } from 'next/og';

/** GET /api/og/modeling — Modeling Hub OG banner (app.financialmodelerpro.com) */
export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        fontFamily: 'Arial, sans-serif', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', display: 'flex' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '0 80px', position: 'relative', textAlign: 'center' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 36 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#fff' }}>FMP</div>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#ffffff' }}>Financial Modeler Pro</span>
          </div>

          {/* Badge — blue like modeling hero */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 20px', borderRadius: 20, background: 'rgba(27,79,138,0.18)', border: '1px solid rgba(27,79,138,0.45)', marginBottom: 28 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#93C5FD', letterSpacing: '0.04em' }}>📐 Professional Modeling Platform</span>
          </div>

          {/* Headline — matches modeling hero */}
          <div style={{ fontSize: 52, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, marginBottom: 20, maxWidth: 800, letterSpacing: '-0.02em' }}>
            Build Institutional-Grade Financial Models
          </div>

          {/* Subline */}
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, maxWidth: 680 }}>
            Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more.
          </div>
        </div>

        <div style={{ padding: '18px 48px', position: 'relative', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)' }}>app.financialmodelerpro.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 627 },
  );
}
