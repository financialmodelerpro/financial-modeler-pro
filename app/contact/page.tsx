/**
 * /contact - Public contact page
 */
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getCmsContent, cms, getAllPageSections } from '@/src/lib/shared/cms';
import { ContactForm } from './ContactForm';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { SectionRenderer } from '@/src/components/cms/SectionRenderer';
import { CmsField, cmsVisible } from '@/src/components/cms/CmsField';

export const revalidate = 0;

const MAIN_URL_CT = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata = {
  title: 'Contact Financial Modeler Pro',
  description: 'Get in touch with Financial Modeler Pro for training inquiries, advisory services, or general questions. Based in Pakistan, serving clients across KSA, GCC, and global markets.',
  alternates: { canonical: `${MAIN_URL_CT}/contact` },
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ContactItem {
  type: 'email' | 'phone' | 'location' | 'other';
  icon: string;
  label: string;
  value: string;
  visible?: boolean;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ContactPage() {
  const [content, cmsSections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('contact'),
  ]);

  // ── Extract CMS sections ─────────────────────────────────────────────────
  const heroRaw = cmsSections.find(s => s.section_type === 'hero');
  const bodyRaw = cmsSections.find(s => (s.content as Record<string, unknown>)?._dynamic === 'contact_body');

  const fc = (raw: typeof heroRaw) => raw?.visible !== false ? raw?.content as Record<string, unknown> | undefined : undefined;

  // ── Contact items from CMS ───────────────────────────────────────────────
  const bc = fc(bodyRaw);
  const contactItems: ContactItem[] = Array.isArray(bc?.contact_items)
    ? (bc.contact_items as ContactItem[]).filter(i => i.visible !== false)
    : ([
        { type: 'email' as const,    icon: '📧', label: 'Email',   value: cms(content, 'contact', 'email', 'hello@financialmodelerpro.com') },
        { type: 'phone' as const,    icon: '📞', label: 'Phone',   value: cms(content, 'contact', 'phone', '') },
        { type: 'location' as const, icon: '📍', label: 'Address', value: cms(content, 'contact', 'address', '') },
      ] satisfies ContactItem[]).filter(i => i.value);

  // ── Booking URL from founder section ─────────────────────────────────────
  const homeSections = await getAllPageSections('home');
  const founderSection = homeSections.find(s => s.section_type === 'team');
  const bookingUrl = (founderSection?.content as Record<string, unknown>)?.booking_url as string || '';

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Financial Modeler Pro Team');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  // ── Hero ──────────────────────────────────────────────────────────────────
  const hc = fc(heroRaw);
  const heroBadge = (hc?.badge as string) || 'Reach Out';
  const heroHead  = (hc?.headline as string) || 'Get in Touch';
  const heroSub   = (hc?.subtitle as string) || 'Have a question about the platform, pricing, or a partnership? We would love to hear from you.';

  // ── Contact body ─────────────────────────────────────────────────────────
  const contactBody = (
    <section style={{ padding: '56px 40px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40, alignItems: 'start' }}>

        {/* Left - Contact info */}
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>Contact Information</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {contactItems.map((item, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                  {item.type === 'email' ? (
                    <a href={`mailto:${item.value}`} style={{ fontSize: 14, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-word' }}>
                      {item.value}
                    </a>
                  ) : item.type === 'phone' ? (
                    <a href={`tel:${item.value.replace(/\s/g, '')}`} style={{ fontSize: 14, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>
                      {item.value}
                    </a>
                  ) : (
                    <span style={{ fontSize: 14, color: '#374151', wordBreak: 'break-word' }}>{item.value}</span>
                  )}
                </div>
              </div>
            ))}

            {/* Book a Meeting card */}
            {bookingUrl && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>📅</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803D', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Book a Meeting</div>
                  <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 12, margin: '0 0 12px' }}>Schedule a 1-on-1 consultation</p>
                  <Link href="/book-a-meeting" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1ABC9C', color: '#fff', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 6, textDecoration: 'none' }}>
                    Book a Meeting →
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 32, background: '#0A2248', borderRadius: 14, padding: '24px 20px', color: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Response Time</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.65, margin: 0 }}>
              We typically respond within 1-2 business days. For urgent inquiries, please include &ldquo;URGENT&rdquo; in the subject line.
            </p>
          </div>
        </div>

        {/* Right - Contact form */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '36px 32px', border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>Send a Message</h2>
          <ContactForm />
        </div>

      </div>
    </section>
  );

  // CMS-driven rendering
  if (cmsSections.length > 0) {
    return (
      <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>
        <NavbarServer />
        <div style={{ height: 64 }} />

        {cmsSections.map((section) => {
          if ((section.content as Record<string, unknown>)?._dynamic === 'contact_body') {
            return section.visible === false ? null : <div key={section.id}>{contactBody}</div>;
          }
          return section.visible === false ? null : <SectionRenderer key={section.id} sections={[section]} />;
        })}

        <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
      </div>
    );
  }

  // Fallback
  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <section style={{ background: 'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', padding: '64px 40px 56px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {cmsVisible(hc ?? {}, 'badge') && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>{heroBadge}</div>
          )}
          {cmsVisible(hc ?? {}, 'headline') && (
            <h1 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 800, color: '#fff', marginBottom: 14, lineHeight: 1.15 }}>{heroHead}</h1>
          )}
          <CmsField
            content={hc ?? { subtitle: heroSub }}
            field="subtitle"
            as="p"
            style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto' }}
          />
        </div>
      </section>

      {contactBody}

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
