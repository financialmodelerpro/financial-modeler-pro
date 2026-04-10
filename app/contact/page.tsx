/**
 * /contact — Public contact page
 */
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getCmsContent, cms, getPageSections } from '@/src/lib/shared/cms';
import { ContactForm } from './ContactForm';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { SectionRenderer } from '@/src/components/cms/SectionRenderer';

export const revalidate = 3600; // revalidate every hour

export const metadata = {
  title: 'Contact Us — Financial Modeler Pro',
  description: 'Get in touch with the Financial Modeler Pro team.',
};

export default async function ContactPage() {
  const [content, sections] = await Promise.all([
    getCmsContent(),
    getPageSections('contact'),
  ]);

  const contactEmail   = cms(content, 'contact', 'email',    'hello@financialmodelerpro.com');
  const contactPhone   = cms(content, 'contact', 'phone',    '');
  const contactAddress = cms(content, 'contact', 'address',  '');
  const contactMapsUrl = cms(content, 'contact', 'maps_url', '');

  type CustomField = { label: string; value: string };
  let customFields: CustomField[] = [];
  try {
    const raw = cms(content, 'contact', 'custom_fields', '');
    if (raw) customFields = JSON.parse(raw) as CustomField[];
  } catch { /* ignore */ }

  const infoItems = [
    { icon:'📧', label:'Email',   value: contactEmail,   href: contactEmail ? `mailto:${contactEmail}` : null },
    { icon:'📞', label:'Phone',   value: contactPhone,   href: contactPhone ? `tel:${contactPhone}` : null },
    { icon:'📍', label:'Address', value: contactAddress, href: null },
    { icon:'🗺️', label:'Maps',    value: contactMapsUrl ? 'View on Google Maps' : '', href: contactMapsUrl || null },
  ].filter(i => i.value);

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  // Shared contact body JSX (used by both CMS and fallback paths)
  const contactBody = (
    <section style={{ padding:'56px 40px 80px' }}>
      <div style={{ maxWidth:1000, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:40, alignItems:'start' }}>

        {/* Left — Contact info */}
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, color:'#1B3A6B', marginBottom:24 }}>Contact Information</h2>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {infoItems.map(item => (
              <div key={item.label} style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:'18px 20px', display:'flex', alignItems:'flex-start', gap:14 }}>
                <span style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#9CA3AF', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>{item.label}</div>
                  {item.href ? (
                    <a href={item.href} target={item.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                      style={{ fontSize:14, color:'#1B4F8A', fontWeight:600, textDecoration:'none', wordBreak:'break-word' }}>
                      {item.value}
                    </a>
                  ) : (
                    <span style={{ fontSize:14, color:'#374151', wordBreak:'break-word' }}>{item.value}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {customFields.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:16 }}>
              {customFields.map((field, i) => {
                const isUrl = /^https?:\/\//.test(field.value) || /^(linkedin|youtube|www\.)/i.test(field.value);
                const href = isUrl ? (field.value.startsWith('http') ? field.value : `https://${field.value}`) : null;
                return (
                  <div key={i} style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:'18px 20px', display:'flex', alignItems:'flex-start', gap:14 }}>
                    <span style={{ fontSize:22, flexShrink:0, marginTop:1 }}>🔗</span>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#9CA3AF', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>{field.label}</div>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize:14, color:'#1B4F8A', fontWeight:600, textDecoration:'none', wordBreak:'break-word' }}>{field.value}</a>
                      ) : (
                        <span style={{ fontSize:14, color:'#374151', wordBreak:'break-word' }}>{field.value}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop:32, background:'#0A2248', borderRadius:14, padding:'24px 20px', color:'#fff' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,0.6)', marginBottom:8 }}>Response Time</div>
            <p style={{ fontSize:14, color:'rgba(255,255,255,0.8)', lineHeight:1.65, margin:0 }}>
              We typically respond within 1-2 business days. For urgent inquiries, please include &ldquo;URGENT&rdquo; in the subject line.
            </p>
          </div>
        </div>

        {/* Right — Contact form */}
        <div style={{ background:'#fff', borderRadius:16, padding:'36px 32px', border:'1px solid #E5E7EB', boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize:20, fontWeight:800, color:'#1B3A6B', marginBottom:24 }}>Send a Message</h2>
          <ContactForm />
        </div>

      </div>
    </section>
  );

  // CMS-driven rendering
  if (sections.length > 0) {
    return (
      <div style={{ fontFamily:"'Inter',-apple-system,sans-serif", background:'#F5F7FA', minHeight:'100vh', color:'#374151' }}>
        <NavbarServer />
        <div style={{ height:64 }} />

        {sections.map((section) => {
          if ((section.content as Record<string, unknown>)?._dynamic === 'contact_body') {
            return <div key={section.id}>{contactBody}</div>;
          }
          return <SectionRenderer key={section.id} sections={[section]} />;
        })}

        <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
      </div>
    );
  }

  // Fallback: original hardcoded layout
  return (
    <div style={{ fontFamily:"'Inter',-apple-system,sans-serif", background:'#F5F7FA', minHeight:'100vh', color:'#374151' }}>
      <NavbarServer />
      <div style={{ height:64 }} />

      {/* Hero */}
      <section style={{ background:'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', padding:'64px 40px 56px', textAlign:'center', color:'#fff' }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:12 }}>
            Reach Out
          </div>
          <h1 style={{ fontSize:'clamp(28px,4vw,44px)', fontWeight:800, color:'#fff', marginBottom:14, lineHeight:1.15 }}>
            Get in Touch
          </h1>
          <p style={{ fontSize:15, color:'rgba(255,255,255,0.55)', lineHeight:1.7, maxWidth:480, margin:'0 auto' }}>
            Have a question about the platform, pricing, or a partnership? We would love to hear from you.
          </p>
        </div>
      </section>

      {contactBody}

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
