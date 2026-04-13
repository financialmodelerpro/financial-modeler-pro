import type { Metadata } from 'next';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
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

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <section style={{ padding: '80px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {/* Founder photo */}
          {photoUrl && (
            <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt={name} style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(74,144,217,0.4)' }} />
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Schedule a Call</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 8, lineHeight: 1.15 }}>Book a Meeting</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, marginBottom: 8 }}>
            with <strong style={{ color: '#fff' }}>{name}</strong>
          </p>
          {/* Title */}
          <div style={{ marginBottom: 8 }}>
            {title.split('|').map((line, i) => (
              <div key={i} style={{ fontSize: 14, color: i === 0 ? '#93C5FD' : '#1ABC9C', fontWeight: 500 }}>{line.trim()}</div>
            ))}
          </div>
          {quals && (
            <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em', marginBottom: 32 }}>{quals}</div>
          )}

          {bookingUrl ? (
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: '48px 32px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>📅</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Ready to connect?</h2>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, marginBottom: 32, maxWidth: 440, margin: '0 auto 32px' }}>
                Select a convenient time for a one-on-one consultation about financial modeling, corporate finance, or platform inquiries.
              </p>
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: '#1ABC9C', color: '#fff', fontWeight: 700, fontSize: 16,
                padding: '16px 40px', borderRadius: 10, textDecoration: 'none',
                boxShadow: '0 4px 24px rgba(26,188,156,0.35)',
              }}>
                Open Booking Calendar →
              </a>
              <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
                You will be redirected to our secure Microsoft Bookings page
              </p>
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: '60px 32px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>📅</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Booking Calendar Coming Soon</h2>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
                Contact us at{' '}
                <a href="mailto:hello@financialmodelerpro.com" style={{ color: '#4A90D9', textDecoration: 'none' }}>hello@financialmodelerpro.com</a>
              </p>
            </div>
          )}
        </div>
      </section>

      <SharedFooter
        company="Financial Modeler Pro is a product of PaceMakers Business Consultants"
        founder="Ahmad Din — CEO & Founder"
        copyright={`${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`}
      />
    </div>
  );
}
