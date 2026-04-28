import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { loadOgFonts } from '@/src/shared/ogFonts';
import sharp from 'sharp';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session     = searchParams.get('session') || 'Assessment Passed';
  const score       = searchParams.get('score') || '100';
  const date        = searchParams.get('date') || '';
  const course      = searchParams.get('course') || '3-Statement Financial Modeling';
  const studentName = searchParams.get('name') || '';
  const regId       = searchParams.get('regId') || '';
  const hasAssessment = searchParams.get('has_assessment') !== 'false';
  const durationRaw   = parseInt(searchParams.get('duration') || '0', 10);
  const durationMin   = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;

  const formatDuration = (mins: number): string => {
    if (mins <= 0) return '';
    if (mins < 60) return `${mins} MIN`;
    const h = Math.floor(mins / 60);
    const m = mins - h * 60;
    if (m === 0) return `${h}H`;
    return `${h}H ${m}M`;
  };
  const durationLabel = formatDuration(durationMin);

  const eyebrowLabel = hasAssessment ? 'Assessment Passed' : 'Session Completed';
  const eyebrowIcon  = hasAssessment ? '🏆' : '🎓';

  const fonts = await loadOgFonts().catch(() => []);

  // Scale the hero session title down as it gets longer so it fits on a single
  // line in most cases. Bucket thresholds chosen against 720px of horizontal
  // space at Inter 800 weight; the last bucket allows a graceful wrap to two
  // lines for extreme outliers instead of overflowing.
  const sessionLen = session.length;
  const sessionFontSize =
    sessionLen <= 24 ? 44 :
    sessionLen <= 34 ? 36 :
    sessionLen <= 48 ? 30 :
    26;

  // Fetch header settings - same source and rules as NavbarServer + Navbar
  let logoDataUri = '';
  let logoEnabled = true;
  let showBrandName = true;
  let brandName = 'Financial Modeler Pro';
  let iconDataUri = '';
  let iconInHeader = false;
  let cardLogoHeight = 48;

  try {
    const sb = getServerClient();
    const { data: rows } = await sb
      .from('cms_content')
      .select('section, key, value')
      .in('section', ['header_settings', 'branding', 'platform'])
      .in('key', ['logo_url', 'logo_enabled', 'logo_height_px', 'show_brand_name', 'brand_name', 'icon_url', 'icon_in_header', 'icon_size_px', 'achievement_card_logo_height']);
    const map: Record<string, string> = {};
    for (const r of (rows ?? []) as { section: string; key: string; value: string }[]) {
      // header_settings takes priority over branding/platform
      const k = `${r.section}__${r.key}`;
      map[k] = r.value;
    }
    const hs = (k: string) => map[`header_settings__${k}`] || '';
    // Same fallback chain as NavbarServer line 34
    const logoUrl = hs('logo_url') || map['branding__logo_url'] || map['platform__logo_url'] || '';
    logoEnabled = hs('logo_enabled') !== 'false';
    showBrandName = hs('show_brand_name') !== 'false';
    brandName = hs('brand_name') || 'Financial Modeler Pro';
    iconInHeader = hs('icon_in_header') === 'true';
    const iconUrl = hs('icon_url') || '';
    cardLogoHeight = parseInt(hs('achievement_card_logo_height')) || 48;

    console.log('[achievement-image] logoUrl:', logoUrl || '(empty)', 'logoEnabled:', logoEnabled, 'iconUrl:', iconUrl || '(empty)', 'iconInHeader:', iconInHeader);

    // Convert image to base64 data URI for satori
    async function fetchAsBase64(url: string, label: string): Promise<string> {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        console.log(`[achievement-image] ${label} fetch: status=${res.status} url=${url.substring(0, 80)}`);
        if (!res.ok) return '';
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`[achievement-image] ${label} size: ${buf.byteLength} bytes`);
        if (buf.byteLength < 50) return '';
        const ct = res.headers.get('content-type') || '';
        const isSvg = ct.includes('svg') || ct.includes('xml') || url.toLowerCase().endsWith('.svg');
        console.log(`[achievement-image] ${label} type: ${ct} isSvg: ${isSvg}`);
        if (isSvg) {
          // Try sharp SVG→PNG conversion
          try {
            const pngBuf = await sharp(buf).resize({ height: 200 }).png().toBuffer();
            console.log(`[achievement-image] ${label} sharp SVG→PNG: ${pngBuf.byteLength} bytes`);
            return `data:image/png;base64,${pngBuf.toString('base64')}`;
          } catch (sharpErr) {
            console.error(`[achievement-image] ${label} sharp failed:`, sharpErr);
            // Fallback: try raw SVG as data URI (works for simple SVGs)
            return `data:image/svg+xml;base64,${buf.toString('base64')}`;
          }
        }
        const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch (fetchErr) {
        console.error(`[achievement-image] ${label} fetch error:`, fetchErr);
        return '';
      }
    }

    if (logoEnabled && logoUrl) {
      logoDataUri = await fetchAsBase64(logoUrl, 'logo');
      console.log('[achievement-image] logo result:', logoDataUri ? `${logoDataUri.length} chars` : 'EMPTY');
    }
    if (iconInHeader && iconUrl) {
      iconDataUri = await fetchAsBase64(iconUrl, 'icon');
    }
  } catch (err) {
    console.error('[achievement-image] Header settings fetch error:', err);
  }

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0D2E5A', fontFamily: 'Inter, Arial, sans-serif', position: 'relative',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Icon - same rule as Navbar: iconInHeader && iconUrl */}
            {iconDataUri && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconDataUri} alt="" style={{ width: 28, height: 28, flexShrink: 0 }} />
            )}
            {/* Logo image - same rule as Navbar: logoEnabled && logoUrl */}
            {logoDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUri} alt={brandName} style={{ height: cardLogoHeight }} />
            ) : !logoEnabled ? null : (
              /* No icon rendered and no logo image - show text brand like Navbar fallback */
              !iconDataUri ? (
                <div style={{
                  width: 48, height: 48, borderRadius: 12, background: '#2EAA4A',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px',
                }}>FMP</div>
              ) : null
            )}
            {/* Brand name - only when no logo image is showing */}
            {!logoDataUri && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', letterSpacing: '0.3px' }}>{brandName}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '1.2px', textTransform: 'uppercase' as const }}>Training Hub - Certification Program</span>
              </div>
            )}
          </div>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px' }}>learn.financialmodelerpro.com</span>
        </div>

        {/* Main content */}
        <div style={{
          display: 'flex', flex: 1, alignItems: 'center', padding: '0 48px',
          gap: 56, position: 'relative',
        }}>
          {/* Left - achievement info */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
              padding: '8px 18px', background: 'rgba(201,168,76,0.15)',
              borderRadius: 8, border: '1px solid rgba(201,168,76,0.3)',
              alignSelf: 'flex-start',
            }}>
              <span style={{ fontSize: 20 }}>{eyebrowIcon}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#C9A84C', letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>{eyebrowLabel}</span>
            </div>

            <div style={{ fontSize: sessionFontSize, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, marginBottom: 10, maxWidth: 760 }}>
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

            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {durationLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
                  <span>⏱</span> <span>{durationLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right - context-aware visual. With assessment = score circle.
              Without assessment = session-completed visual with duration. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            {hasAssessment ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 200, height: 200, borderRadius: '50%',
                  border: '10px solid #14B8A6',
                  background: 'rgba(20,184,166,0.08)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 40px rgba(20,184,166,0.15)',
                }}>
                  {durationLabel ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: 56, fontWeight: 900, color: '#14B8A6', lineHeight: 1 }}>{durationLabel}</span>
                      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 6, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const }}>Session</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: 72, lineHeight: 1 }}>🎥</span>
                      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 8, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const }}>Session</span>
                    </div>
                  )}
                </div>
                <div style={{
                  marginTop: 16, padding: '6px 20px', borderRadius: 20,
                  background: '#14B8A6', color: '#fff',
                  fontSize: 13, fontWeight: 800, letterSpacing: '1.5px',
                  textTransform: 'uppercase' as const,
                }}>
                  ✓ Attended
                </div>
              </div>
            )}
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
    { width: 1200, height: 630, fonts },
  );
}
