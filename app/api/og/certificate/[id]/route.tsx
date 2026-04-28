import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { loadOgFonts } from '@/src/shared/ogFonts';
import sharp from 'sharp';

export const runtime = 'nodejs';

/**
 * Dynamic OG image for a certificate verification share.
 *   GET /api/og/certificate/{certificate_id}   →   1200×630 PNG
 *
 * Used by /verify/[uuid] metadata so LinkedIn / Twitter / WhatsApp previews
 * show a branded card with the student's name + course + grade instead of
 * a generic site banner.
 */

async function fetchAsBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 50) return '';
    const ct = res.headers.get('content-type') || '';
    const isSvg = ct.includes('svg') || ct.includes('xml') || url.toLowerCase().endsWith('.svg');
    if (isSvg) {
      try {
        const png = await sharp(buf).resize({ height: 200 }).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
      } catch {
        return `data:image/svg+xml;base64,${buf.toString('base64')}`;
      }
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
    for (const r of (rows ?? []) as { section: string; key: string; value: string }[]) {
      map[`${r.section}__${r.key}`] = r.value;
    }
    const logoUrl = map['header_settings__logo_url'] || map['branding__logo_url'] || map['platform__logo_url'] || '';
    const logoEnabled = map['header_settings__logo_enabled'] !== 'false';
    if (logoEnabled && logoUrl) return await fetchAsBase64(logoUrl);
  } catch { /* skip */ }
  return '';
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServerClient();

  const [{ data: cert }, fonts, logoDataUri] = await Promise.all([
    sb.from('student_certificates')
      .select('certificate_id, full_name, course, course_code, grade, issued_at, issued_date, cert_status')
      .eq('certificate_id', id)
      .maybeSingle(),
    loadOgFonts().catch(() => []),
    fetchLogo(),
  ]);

  const studentName = (cert?.full_name as string | null) ?? 'Student';
  const courseName  = (cert?.course as string | null) ?? (cert?.course_code as string | null) ?? 'Financial Modeling';
  const grade       = (cert?.grade as string | null) ?? '';
  const issued      = formatDate((cert?.issued_at as string | null) ?? (cert?.issued_date as string | null));
  const certId      = (cert?.certificate_id as string | null) ?? id;
  const isIssued    = cert?.cert_status === 'Issued';

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0D2E5A', fontFamily: 'Inter, Arial, sans-serif', position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Gradient backdrop */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 45%, #1B4F8A 100%)', display: 'flex' }} />
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -90, right: -90, width: 380, height: 380, borderRadius: '50%', background: 'rgba(201,168,76,0.08)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(46,170,74,0.08)', display: 'flex' }} />

        {/* Top bar: logo + brand */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '28px 48px', position: 'relative',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          {logoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUri} alt="" style={{ height: 38 }} />
          ) : (
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '0.3px', display: 'flex' }}>
              Financial Modeler Pro
            </div>
          )}
          <div style={{ flex: 1, display: 'flex' }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px' }}>
            learn.financialmodelerpro.com/verify
          </span>
        </div>

        {/* Main */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', padding: '0 56px', gap: 48, position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22,
              padding: '8px 18px', background: 'rgba(201,168,76,0.18)',
              borderRadius: 8, border: '1px solid rgba(201,168,76,0.4)',
              alignSelf: 'flex-start',
            }}>
              <span style={{ fontSize: 18 }}>{isIssued ? '✅' : '🔍'}</span>
              <span style={{
                fontSize: 14, fontWeight: 800, color: '#C9A84C',
                letterSpacing: '1.4px', textTransform: 'uppercase' as const,
              }}>
                {isIssued ? 'Verified Certificate' : 'Certificate'}
              </span>
            </div>

            {/* Student name */}
            <div style={{
              fontSize: 42, fontWeight: 800, color: '#ffffff',
              lineHeight: 1.1, marginBottom: 16, letterSpacing: '-0.02em',
              maxWidth: 720,
            }}>
              {studentName}
            </div>

            {/* Course */}
            <div style={{
              fontSize: 22, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4,
              marginBottom: 22, maxWidth: 720,
            }}>
              earned the <span style={{ color: '#C9A84C', fontWeight: 700 }}>{courseName}</span> certification
            </div>

            {/* Meta pills */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' as const }}>
              {grade && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 16px', borderRadius: 999,
                  background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.4)',
                }}>
                  <span style={{ fontSize: 14 }}>🏆</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#8FDCA0' }}>Grade: {grade}</span>
                </div>
              )}
              {issued && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 16px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                }}>
                  <span style={{ fontSize: 14 }}>📅</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Issued {issued}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right — seal */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{
              width: 220, height: 220, borderRadius: '50%',
              border: '12px solid #C9A84C',
              background: 'rgba(201,168,76,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 60px rgba(201,168,76,0.25)',
            }}>
              <span style={{ fontSize: 96 }}>🎓</span>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: '18px 48px', position: 'relative',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em' }}>
            Verified by Financial Modeler Pro · Professional Financial Modeling Certification
          </span>
          <span style={{ fontSize: 12, fontFamily: 'Courier', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>
            {certId}
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}
