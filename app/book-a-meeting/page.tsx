import type { Metadata } from 'next';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getAllPageSections } from '@/src/lib/shared/cms';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Book a Meeting — Financial Modeler Pro',
  description: 'Schedule a call with Ahmad Din — Corporate Finance & Financial Modeling Expert.',
};

export default async function BookAMeetingPage() {
  const sections = await getAllPageSections('home');
  const founderSection = sections.find(s => s.section_type === 'team');
  const bookingUrl = (founderSection?.content as Record<string, unknown>)?.booking_url as string ?? '';

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '64px 40px 48px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Schedule a Call</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 14, lineHeight: 1.15 }}>Book a Meeting</h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
            Schedule a call with Ahmad Din — Corporate Finance &amp; Financial Modeling Expert.
          </p>
        </div>
      </section>

      {/* Booking embed */}
      <section style={{ padding: '0 40px 80px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {bookingUrl ? (
            <iframe
              src={bookingUrl}
              width="100%"
              height="800"
              frameBorder={0}
              scrolling="yes"
              style={{ border: 'none', borderRadius: 12, minHeight: 700, background: '#fff' }}
              title="Book a Meeting"
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 24px', background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
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
