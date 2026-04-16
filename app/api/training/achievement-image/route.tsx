import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session = searchParams.get('session') || 'Assessment Passed';
  const score   = searchParams.get('score') || '100';
  const date    = searchParams.get('date') || '';
  const course  = searchParams.get('course') || '3-Statement Financial Modeling';

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(135deg, #0D2E5A 0%, #1B4F8A 60%, #2E75B6 100%)',
        fontFamily: 'Arial, sans-serif', padding: '48px 56px', position: 'relative',
      }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 48 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10, background: '#2EAA4A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
          }}>📐</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', letterSpacing: '0.5px' }}>Financial Modeler Pro</span>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: '1px', textTransform: 'uppercase' as const }}>Training &amp; Certification</span>
          </div>
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 48 }}>
          {/* Left — Text */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏆</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#C9A84C', textTransform: 'uppercase' as const, letterSpacing: '2px', marginBottom: 12 }}>
              Assessment Passed
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', lineHeight: 1.3, marginBottom: 16, maxWidth: 540 }}>
              {session}
            </div>
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', marginBottom: 24 }}>
              {course}
            </div>
            {date && (
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center', gap: 8 }}>
                📅 {date}
              </div>
            )}
          </div>

          {/* Right — Score circle */}
          <div style={{
            width: 180, height: 180, borderRadius: '50%',
            border: '8px solid #2EAA4A', background: 'rgba(46,170,74,0.1)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 56, fontWeight: 900, color: '#2EAA4A' }}>{score}%</span>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: -4 }}>score</span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)' }}>learn.financialmodelerpro.com</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Free Professional Certification</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
