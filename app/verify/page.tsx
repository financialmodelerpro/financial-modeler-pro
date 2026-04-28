import type { Metadata } from 'next';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { VerifySearchForm } from './VerifySearchForm';

export const metadata: Metadata = {
  title: 'Verify a Certificate | Financial Modeler Pro',
  description: 'Enter a Certificate ID to verify its authenticity. All Financial Modeler Pro certificates include a unique ID and QR code.',
};

export default function VerifyLandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        padding: 'clamp(56px,8vw,96px) 40px clamp(48px,7vw,80px)',
        textAlign: 'center', color: '#fff',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h1 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, marginBottom: 12, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Verify a Certificate
          </h1>
          <p style={{ fontSize: 'clamp(14px,2vw,17px)', color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto' }}>
            Enter a Certificate ID to verify its authenticity. All Financial Modeler Pro certificates include a unique ID and QR code.
          </p>
        </div>
      </section>

      {/* Search form */}
      <section style={{ padding: '48px 40px', flex: 1 }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <VerifySearchForm />

          {/* Info box */}
          <div style={{ marginTop: 40, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: '24px 28px' }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A', marginBottom: 16 }}>How to find your Certificate ID</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                'Certificate ID is printed on your certificate',
                'It appears in your certificate email',
                'Format: FMP-[COURSE]-[YEAR]-[SERIAL]',
                'Scan the QR code on your certificate',
              ].map(text => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#2EAA4A', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <SharedFooter
        company="Financial Modeler Pro is a product of PaceMakers Business Consultants"
        founder="Ahmad Din - CEO & Founder"
        copyright={`${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`}
      />
    </div>
  );
}
