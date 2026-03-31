import type { Metadata } from 'next';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getCmsContent, cms } from '@/src/lib/cms';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Confidentiality & Terms — Financial Modeler Pro',
  description: 'Terms of use and confidentiality agreement for Financial Modeler Pro platform and training materials.',
};

const DEFAULT_CONTENT = `By accessing Financial Modeler Pro platform and training materials, you agree to the following terms.

1. COURSE MATERIALS
All course content, videos, assessments, and materials are proprietary to Financial Modeler Pro and PaceMakers Business Consultants. You may not reproduce, distribute, or share these materials without written permission.

2. CERTIFICATE USE
Certificates issued through this platform are for personal professional use. They may be shared on LinkedIn and professional profiles. Misrepresentation of certification status is prohibited.

3. PLATFORM USE
This platform is provided for educational purposes. Users agree not to attempt to circumvent assessment systems or share assessment answers.

4. INTELLECTUAL PROPERTY
All financial models, templates, and methodologies presented in courses are the intellectual property of Ahmad Din and PaceMakers Business Consultants.

5. CONTACT
For terms-related questions, contact us at meetahmadch@gmail.com`;

export default async function ConfidentialityPage() {
  const content = await getCmsContent();

  const title   = cms(content, 'confidentiality', 'title',   'Confidentiality & Terms of Use');
  const updated = cms(content, 'confidentiality', 'updated', 'March 2026');
  const body    = cms(content, 'confidentiality', 'content', DEFAULT_CONTENT);

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
