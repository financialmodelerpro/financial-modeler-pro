import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session     = searchParams.get('session') || 'Assessment Passed';
  const score       = searchParams.get('score') || '100';
  const date        = searchParams.get('date') || '';
  const course      = searchParams.get('course') || '3-Statement Financial Modeling';
  const studentName = searchParams.get('name') || '';
  const regId       = searchParams.get('regId') || '';

  // Fetch logo from same source as header (cms_content.header_settings.logo_url)
  // Satori only supports raster images (PNG/JPEG/WebP) — SVG will use text fallback
  let logoDataUri = '';
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', 'header_settings')
      .eq('key', 'logo_url')
      .maybeSingle();
    const logoUrl = data?.value || '';
    if (logoUrl) {
      const res = await fetch(logoUrl, { cache: 'no-store' });
      const contentType = res.headers.get('content-type') || '';
      // Only use raster images — SVG cannot be rendered by satori via <img>
      const isSvg = contentType.includes('svg') || logoUrl.toLowerCase().endsWith('.svg');
      if (res.ok && !isSvg) {
        const buf = await res.arrayBuffer();
        logoDataUri = `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`;
      }
    }
  } catch { /* text fallback */ }

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0D2E5A', fontFamily: 'Arial, sans-serif', position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(145deg, #0D2E5A 0%, #1B4F8A 50%, #2563EB 100%)', display: 'flex' }} />
        {/* Decorative elements */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.02)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: 200, right: 140, width: 120, height: 120, borderRadius: '50%', background: 'rgba(46,170,74,0.08)', display: 'flex' }} />

        {/* Top bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '28px 48px', position: 'relative',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUri} alt="FMP" style={{ height: 48, width: 'auto' }} />
            ) : (
              <>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, background: '#2EAA4A',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px',
                }}>FMP</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', letterSpacing: '0.3px' }}>Financial Modeler Pro</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '1.2px', textTransform: 'uppercase' as const }}>Certification Program</span>
                </div>
              </>
            )}
          </div>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px' }}>learn.financialmodelerpro.com</span>
        </div>

        {/* Main content */}
        <div style={{
          display: 'flex', flex: 1, alignItems: 'center', padding: '0 48px',
          gap: 56, position: 'relative',
        }}>
          {/* Left — achievement info */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
              padding: '8px 18px', background: 'rgba(201,168,76,0.15)',
              borderRadius: 8, border: '1px solid rgba(201,168,76,0.3)',
              alignSelf: 'flex-start',
            }}>
              <span style={{ fontSize: 20 }}>🏆</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#C9A84C', letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>Assessment Passed</span>
            </div>

            <div style={{ fontSize: 36, fontWeight: 800, color: '#ffffff', lineHeight: 1.25, marginBottom: 10, maxWidth: 560 }}>
              {session}
            </div>

            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', marginBottom: 16, lineHeight: 1.4 }}>
              {course}
            </div>

            {studentName && (
              <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: 16 }}>
                {studentName}
              </div>
            )}

            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {date && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
                  <span>📅</span> <span>{date}</span>
                </div>
              )}
              {regId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
                  <span>🪪</span> <span>{regId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right — score display */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{
              width: 200, height: 200, borderRadius: '50%',
              border: '10px solid #2EAA4A',
              background: 'rgba(46,170,74,0.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 40px rgba(46,170,74,0.15)',
            }}>
              <span style={{ fontSize: 64, fontWeight: 900, color: '#2EAA4A', lineHeight: 1 }}>{score}%</span>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 2, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const }}>Score</span>
            </div>
            <div style={{
              marginTop: 16, padding: '6px 20px', borderRadius: 20,
              background: '#2EAA4A', color: '#fff',
              fontSize: 13, fontWeight: 800, letterSpacing: '1.5px',
              textTransform: 'uppercase' as const,
            }}>
              ✓ PASSED
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: '20px 48px', position: 'relative',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.5px' }}>
            Free Professional Financial Modeling Certification Program
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
