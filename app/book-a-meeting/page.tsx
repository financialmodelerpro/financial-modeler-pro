import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getAllPageSections, getFounderProfile, cms } from '@/src/lib/shared/cms';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Book a Meeting — Financial Modeler Pro',
  description: 'Schedule a call with Ahmad Din — Corporate Finance & Financial Modeling Expert.',
};

export default async function BookAMeetingPage() {
  const [homeSections, founder] = await Promise.all([
    getAllPageSections('home'),
    getFounderProfile(),
  ]);
  const founderSection = homeSections.find(s => s.section_type === 'team');
  const fc = founderSection?.content as Record<string, unknown> | undefined;
  const bookingUrl = (fc?.booking_url as string) ?? '';
  const name = (fc?.name as string) || cms(founder, 'bio', 'name', 'Ahmad Din');
  const title = (fc?.title as string) || 'Corporate Finance & Transaction Advisory Specialist | Financial Modeling Expert';
  const quals = (fc?.qualifications as string) || '';
  const _photoRaw = cms(founder, 'bio', 'photo_url', '');
  const photoUrl = (fc?.photo_url as string) || (_photoRaw.startsWith('data:') || _photoRaw.startsWith('http') ? _photoRaw : _photoRaw ? `data:image/jpeg;base64,${_photoRaw}` : '');
  const expectations = (fc?.booking_expectations as string[]) ?? ['60-minute consultation', 'Financial modeling advice', 'Platform walkthrough', 'Corporate finance guidance'];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          {/* Photo */}
          {photoUrl && (
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt={name} style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(74,144,217,0.4)' }} />
            </div>
          )}

          <h1 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, color: '#fff', marginBottom: 4, lineHeight: 1.15 }}>Book a Meeting</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>with <strong style={{ color: '#fff' }}>{name}</strong></p>

          <div style={{ marginBottom: 4 }}>
            {title.split('|').map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: i === 0 ? '#93C5FD' : '#1ABC9C', fontWeight: 500 }}>{line.trim()}</div>
            ))}
          </div>
          {quals && <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.05em', marginBottom: 24 }}>{quals}</div>}

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '16px 0 24px' }} />

          {/* Expectations */}
          {expectations.length > 0 && (
            <div style={{ textAlign: 'left', marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>What to expect</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {expectations.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#1ABC9C', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '0 0 28px' }} />

          {bookingUrl ? (
            <>
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{
                display: 'block', width: '100%', textAlign: 'center',
                background: '#1ABC9C', color: '#fff', fontWeight: 700, fontSize: 16,
                padding: '16px 24px', borderRadius: 10, textDecoration: 'none',
                boxShadow: '0 4px 24px rgba(26,188,156,0.35)',
              }}>
                📅 Open Booking Calendar →
              </a>
              <p style={{ marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                You will be redirected to our Microsoft Bookings page to select your preferred time slot.
              </p>
            </>
          ) : (
            <div style={{ padding: '32px 20px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Coming Soon</h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                Contact us at{' '}
                <a href="mailto:hello@financialmodelerpro.com" style={{ color: '#4A90D9', textDecoration: 'none' }}>hello@financialmodelerpro.com</a>
              </p>
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <Link href="/" style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textDecoration: 'none' }}>← Back to Home</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
