import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getAllPageSections } from '@/src/shared/cms';
import { CmsField, cmsVisible } from '@/src/hubs/main/components/cms/CmsField';
import { CalendlyEmbed } from '@/src/hubs/main/components/booking/CalendlyEmbed';

// Per-field width + alignment style from admin VF keys.
function fw(record: Record<string, unknown> | undefined, key: string): React.CSSProperties {
  const align = record?.[`${key}_align`] as string | undefined;
  const width = record?.[`${key}_width`] as string | undefined;
  const style: React.CSSProperties = {};
  if (align) style.textAlign = align as React.CSSProperties['textAlign'];
  if (width && width !== 'auto' && width !== '100%' && width !== '100') {
    style.maxWidth = width.endsWith('%') ? width : `${width}%`;
    style.marginLeft = 'auto';
    style.marginRight = 'auto';
  } else if (width === 'auto') {
    style.maxWidth = 'none';
  }
  return style;
}

export const revalidate = 60;

const MAIN_URL_BAM = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Book a Consultation | Financial Modeling Advisory',
  description: 'Schedule a consultation with Ahmad Din — Corporate Finance & Transaction Advisory Specialist. Financial modeling advisory, deal structuring, and strategic consultations. 60-minute sessions available.',
  alternates: { canonical: `${MAIN_URL_BAM}/book-a-meeting` },
  openGraph: {
    title: 'Book a Consultation | FMP',
    description: 'Consultations with Ahmad Din — Corporate Finance & Transaction Advisory Specialist.',
    url: `${MAIN_URL_BAM}/book-a-meeting`,
  },
};

export default async function BookAMeetingPage() {
  const homeSections = await getAllPageSections('home');
  const founderSection = homeSections.find(s => s.section_type === 'team');
  const fc = founderSection?.content as Record<string, unknown> | undefined;
  const bookingUrl = (fc?.booking_url as string) ?? '';
  const name  = (fc?.name as string)  || 'Ahmad Din';
  const title = (fc?.title as string) || 'Corporate Finance & Transaction Advisory Specialist | Financial Modeling Expert';
  const quals = (fc?.qualifications as string) || '';
  const photoUrl = (fc?.photo_url as string) || '';
  const expectations = (fc?.booking_expectations as string[]) ?? ['60-minute consultation', 'Financial modeling advice', 'Platform walkthrough', 'Corporate finance guidance'];
  const pageHeading = (fc?.booking_page_heading as string) || 'Book a Meeting';
  const backText = (fc?.booking_back_text as string) || '← Back to Founder Profile';
  const backUrl  = (fc?.booking_back_url as string)  || '/about/ahmad-din';
  const expectLabel = (fc?.booking_expectations_label as string) || 'What to expect';

  // Direct contact options (admin-configurable via Founder Editor → Booking Page tab)
  const email          = (fc?.email as string) || '';
  const whatsappNumber = (fc?.whatsapp_number as string) || '';
  const whatsappDigits = whatsappNumber.replace(/[^0-9]/g, '');
  const waPrefill      = encodeURIComponent(`Hi ${name.split(' ')[0]}, I would like to discuss`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <section style={{ flex: 1, padding: '40px 24px 64px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Header card — founder identity + expectations (centered, narrow) */}
          <div style={{ maxWidth: 560, margin: '0 auto 36px', textAlign: 'center' }}>
            {photoUrl && (
              <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt={name} style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(74,144,217,0.4)' }} />
              </div>
            )}

            {cmsVisible(fc ?? {}, 'booking_page_heading') && (
              <h1 style={{ ...fw(fc, 'booking_page_heading'), fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, color: '#fff', marginBottom: 4, lineHeight: 1.15 }}>{pageHeading}</h1>
            )}
            {cmsVisible(fc ?? {}, 'name') && (
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>with <strong style={{ color: '#fff' }}>{name}</strong></p>
            )}

            {cmsVisible(fc ?? {}, 'title') && (
              <div style={{ marginBottom: 4 }}>
                {title.split('|').map((line, i) => (
                  <div key={i} style={{ fontSize: 13, color: i === 0 ? '#93C5FD' : '#1ABC9C', fontWeight: 500 }}>{line.trim()}</div>
                ))}
              </div>
            )}
            {cmsVisible(fc ?? {}, 'qualifications') && quals && (
              <div style={{ ...fw(fc, 'qualifications'), fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.05em', marginBottom: 20 }}>{quals}</div>
            )}

            {/* Expectations */}
            {cmsVisible(fc ?? {}, 'booking_expectations') && expectations.length > 0 && (
              <div style={{ textAlign: 'left', marginTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{expectLabel}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {expectations.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: '#1ABC9C', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Calendly inline embed — primary booking flow */}
          {bookingUrl ? (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, textAlign: 'center' }}>
                Select a Time
              </div>
              <CalendlyEmbed url={bookingUrl} minHeight={700} />
            </div>
          ) : (
            <div style={{ maxWidth: 560, margin: '0 auto 32px', padding: '32px 20px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Booking Calendar Coming Soon</h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                Please contact via email or WhatsApp below.
              </p>
            </div>
          )}

          {/* Direct contact options — each gated on admin visibility + value. */}
          {((cmsVisible(fc ?? {}, 'email') && email) || (cmsVisible(fc ?? {}, 'whatsapp_number') && whatsappDigits)) && (
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {/* I6: reduced flex-basis 180→150 so both buttons fit
                    comfortably side-by-side at 375px instead of being
                    forced to stack. */}
                {cmsVisible(fc ?? {}, 'email') && email && (
                  <a
                    href={`mailto:${email}?subject=${encodeURIComponent('Consultation Inquiry')}`}
                    style={{
                      flex: '1 1 150px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14,
                      padding: '12px 20px', borderRadius: 10, textDecoration: 'none',
                    }}
                  >
                    ✉️ Send Email
                  </a>
                )}
                {cmsVisible(fc ?? {}, 'whatsapp_number') && whatsappDigits && (
                  <a
                    href={`https://wa.me/${whatsappDigits}?text=${waPrefill}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      flex: '1 1 150px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      background: '#25D366', color: '#fff', fontWeight: 700, fontSize: 14,
                      padding: '12px 20px', borderRadius: 10, textDecoration: 'none',
                    }}
                  >
                    💬 WhatsApp
                  </a>
                )}
              </div>
              <div style={{ marginTop: 12, textAlign: 'left', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Direct contact</div>
                {cmsVisible(fc ?? {}, 'email') && email && (
                  <div>📧 <a href={`mailto:${email}`} style={{ color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>{email}</a></div>
                )}
                {cmsVisible(fc ?? {}, 'whatsapp_number') && whatsappDigits && (
                  <div>💬 <a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.65)', textDecoration: 'none' }}>{whatsappNumber}</a></div>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <Link href={backUrl} style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textDecoration: 'none' }}>{backText}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
