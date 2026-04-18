// v-founder-profile-update
import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllPageSections } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { CmsField } from '@/src/components/cms/CmsField';

export const revalidate = 0;

async function getFounderContent(): Promise<Record<string, unknown> | undefined> {
  const sections = await getAllPageSections('home');
  return sections.find(s => s.section_type === 'team')?.content as Record<string, unknown> | undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const fc = await getFounderContent();
  const name  = (fc?.name as string)  || 'Ahmad Din';
  const title = (fc?.title as string) || 'Founder & Lead Instructor - Financial Modeler Pro';
  return {
    title: `${name} - ${title}`,
    description: (fc?.bio as string) || 'Corporate finance specialist and founder of Financial Modeler Pro.',
  };
}

export default async function FounderPage() {
  const fc = await getFounderContent();
  const bookingUrl = (fc?.booking_url as string) ?? '';

  const name       = (fc?.name as string)           || 'Ahmad Din';
  const title      = (fc?.title as string)          || 'Founder & Lead Instructor';
  const quals      = (fc?.qualifications as string) || '';
  const photoUrl   = (fc?.photo_url as string)      || '';
  const shortBio   = (fc?.bio as string)            || '';
  const linkedin   = (fc?.cta_secondary_url as string) || (fc?.linkedin_url as string) || '';
  const philosophy = (fc?.philosophy as string)     || '';

  const longBioRaw = (fc?.long_bio as string) || '';
  const whyFmpRaw  = (fc?.why_fmp as string) || '';

  const expItems      = (fc?.credentials as string[]) ?? [];
  const expertise     = (fc?.expertise as string[]) ?? [];
  const industryFocus = (fc?.industry_focus as string[]) ?? [];
  const marketFocus   = (fc?.market_focus as string) || '';
  const personal      = (fc?.personal as string) || '';
  const projects      = ((fc?.projects as { id: string; title: string; description: string; sector: string; value: string; visible?: boolean }[]) ?? []).filter(p => p.visible !== false);

  // Merge CMS content keys (bio/long_bio/why_fmp/etc.) with their VF suffixes
  // (_align/_width/_visible) so CmsField reads them uniformly.
  const cmsData: Record<string, unknown> = { ...(fc ?? {}) };
  if (!cmsData.bio)          cmsData.bio = shortBio;
  if (!cmsData.long_bio)     cmsData.long_bio = longBioRaw;
  if (!cmsData.philosophy)   cmsData.philosophy = philosophy;
  if (!cmsData.market_focus) cmsData.market_focus = marketFocus;
  if (!cmsData.personal)     cmsData.personal = personal;

  const sectionHeading: React.CSSProperties = { fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 };
  const sectionPadding = '0 40px 72px';

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '80px 40px 64px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 56, alignItems: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={name} style={{ width: '100%', maxWidth: 360, height: 'auto', objectFit: 'contain', borderRadius: 12, display: 'block' }} />
            ) : (
              <div style={{ width: '100%', maxWidth: 360, height: 300, borderRadius: 12, background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 72, fontWeight: 800, color: 'rgba(255,255,255,0.9)', letterSpacing: '-2px' }}>AD</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Founder</div>
            <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 8, lineHeight: 1.1 }}>{name}</h1>
            <div style={{ marginBottom: 4 }}>
              {title.split('|').map((line, i) => (
                <div key={i} style={{ fontSize: i === 0 ? '1rem' : '0.95rem', color: i === 0 ? '#93C5FD' : '#1ABC9C', fontWeight: i === 0 ? 500 : 600, marginBottom: 2 }}>{line.trim()}</div>
              ))}
            </div>
            {quals && <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em', marginBottom: 16, marginTop: 4 }}>{quals}</div>}
            <CmsField
              content={cmsData}
              field="bio"
              style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, marginBottom: 24 }}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {linkedin && (
                <a href={linkedin} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>LinkedIn ↗</a>
              )}
              {bookingUrl && (
                <Link href="/book-a-meeting" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1ABC9C', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>📅 Book a Meeting</Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Background */}
      {longBioRaw && (
        <section style={{ padding: '72px 40px 48px', maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Background</h2>
          <CmsField
            content={cmsData}
            field="long_bio"
            style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8 }}
          />
        </section>
      )}

      {/* Why Financial Modeler Pro */}
      {whyFmpRaw && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Why Financial Modeler Pro</h2>
          <CmsField
            content={cmsData}
            field="why_fmp"
            style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8 }}
          />
        </section>
      )}

      {/* Experience & Background */}
      {expItems.length > 0 && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Experience &amp; Background</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {expItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <span style={{ background: '#1ABC9C', color: '#fff', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                <CmsField
                  content={{ item }}
                  field="item"
                  as="p"
                  style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.6, margin: 0 }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Expertise Areas */}
      {expertise.length > 0 && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Expertise Areas</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {expertise.map((item, i) => (
              <span key={i} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{item}</span>
            ))}
          </div>
        </section>
      )}

      {/* Industry Focus */}
      {industryFocus.length > 0 && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Industry Focus</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {industryFocus.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
                <span style={{ color: '#4A90D9', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>●</span>
                <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{item}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Market Focus */}
      {marketFocus && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Market Focus</h2>
          <CmsField
            content={cmsData}
            field="market_focus"
            style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8 }}
          />
        </section>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <section style={{ padding: sectionPadding, maxWidth: 800, margin: '0 auto' }}>
          <h2 style={sectionHeading}>Notable Projects</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {projects.map(p => (
              <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>{p.title}</h3>
                  {p.sector && <span style={{ fontSize: 11, fontWeight: 600, color: '#4A90D9', background: 'rgba(27,79,138,0.2)', padding: '2px 10px', borderRadius: 12 }}>{p.sector}</span>}
                </div>
                <CmsField
                  content={p as unknown as Record<string, unknown>}
                  field="description"
                  style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}
                />
                {p.value && <div style={{ fontSize: 12, color: '#1ABC9C', fontWeight: 600, marginTop: 8 }}>{p.value}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Philosophy */}
      {philosophy && (
        <section style={{ padding: '64px 40px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 20 }}>Modeling Philosophy</h2>
            <blockquote style={{ borderLeft: '3px solid #1B4F8A', paddingLeft: 24, margin: 0, fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, fontStyle: 'italic' }}>
              <span>&ldquo;</span>
              <CmsField content={cmsData} field="philosophy" as="span" />
              <span>&rdquo;</span>
            </blockquote>
            <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>- {name}</div>
          </div>
        </section>
      )}

      {/* Personal */}
      {personal && (
        <section style={{ padding: '48px 40px 72px', maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>Personal</h2>
          <CmsField
            content={cmsData}
            field="personal"
            style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}
          />
        </section>
      )}

      <SharedFooter
        company="Financial Modeler Pro is a product of PaceMakers Business Consultants"
        founder="Ahmad Din - CEO & Founder"
        copyright={`${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`}
      />
    </div>
  );
}
