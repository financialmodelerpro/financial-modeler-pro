import type { Metadata } from 'next';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getCmsContent, cms } from '@/src/lib/shared/cms';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Privacy Policy — Financial Modeler Pro',
  description: 'How Financial Modeler Pro collects, uses, and protects your personal information.',
};

const DEFAULT_CONTENT = `This Privacy Policy describes how Financial Modeler Pro collects, uses, and protects your personal information. By using our platform, you agree to the collection and use of information in accordance with this policy.

1. INFORMATION WE COLLECT
We collect information you provide when registering for courses, including your name and email address. We also collect usage data such as course progress and assessment scores.

2. HOW WE USE YOUR INFORMATION
Your information is used to provide our certification services, send course results and certificates, and improve our platform.

3. DATA PROTECTION
We implement appropriate security measures to protect your personal information against unauthorized access or disclosure.

4. CONTACT
For privacy-related questions, contact us at meetahmadch@gmail.com`;

export default async function PrivacyPolicyPage() {
  const content = await getCmsContent();

  const title   = cms(content, 'privacy_policy', 'title',   'Privacy Policy');
  const updated = cms(content, 'privacy_policy', 'updated', 'March 2026');
  const body    = cms(content, 'privacy_policy', 'content', DEFAULT_CONTENT);

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright',    `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ background: 'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', padding: '56px 40px 48px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h1 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, color: '#fff', marginBottom: 10 }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>Last updated: {updated}</p>
        </div>
      </section>

      {/* Content */}
      <section style={{ padding: '56px 40px 80px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', padding: '40px 48px', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
          {body.split('\n\n').map((para, i) => (
            <p key={i} style={{ fontSize: 15, lineHeight: 1.8, color: para.match(/^\d+\./) ? '#1B3A6B' : '#374151', fontWeight: para.match(/^\d+\./) ? 700 : 400, marginBottom: 18, whiteSpace: 'pre-wrap' }}>
              {para}
            </p>
          ))}
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
