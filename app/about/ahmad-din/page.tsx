import type { Metadata } from 'next';
import Link from 'next/link';
import { getFounderProfile, cms, getAllPageSections } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const founder = await getFounderProfile();
  const name  = cms(founder, 'bio', 'name',  'Ahmad Din');
  const title = cms(founder, 'bio', 'title', 'Founder & Lead Instructor — Financial Modeler Pro');
  return {
    title: `${name} — ${title}`,
    description: cms(founder, 'bio', 'short_bio', 'Real estate finance professional and founder of Financial Modeler Pro.'),
  };
}

export default async function FounderPage() {
  const [founder, homeSections] = await Promise.all([
    getFounderProfile(),
    getAllPageSections('home'),
  ]);

  const founderSection = homeSections.find(s => s.section_type === 'team');
  const fc = founderSection?.content as Record<string, unknown> | undefined;
  const bookingUrl = (fc?.booking_url as string) ?? '';

  const name       = (fc?.name as string)           || cms(founder, 'bio', 'name',       'Ahmad Din');
  const title      = (fc?.title as string)          || cms(founder, 'bio', 'title',      'Founder & Lead Instructor');
  const quals      = (fc?.qualifications as string) || '';
  const _photoRaw  = cms(founder, 'bio', 'photo_url',  '');
  const photoUrl   = (fc?.photo_url as string)      || (_photoRaw.startsWith('data:') || _photoRaw.startsWith('http') ? _photoRaw : _photoRaw ? `data:image/jpeg;base64,${_photoRaw}` : '');
  const shortBio   = (fc?.bio as string)            || cms(founder, 'bio', 'short_bio',  'Real estate finance professional with 15+ years of deal structuring, development financing, and financial modeling experience across GCC and international markets.');
  const linkedin   = (fc?.cta_secondary_url as string) || (fc?.linkedin_url as string) || cms(founder, 'bio', 'linkedin_url', '');
  const philosophy = (fc?.philosophy as string)     || cms(founder, 'philosophy', 'text', 'A good financial model is not just a calculation — it\'s a communication tool. Every assumption should be visible, every output should be traceable, and the final product should be something you\'d be proud to present to a board or an investor committee without reformatting.');

  const bgParas = (fc?.background_paragraphs as string[]) ?? [];
  const longBio = bgParas.length > 0 ? bgParas : ((fc?.long_bio as string) || cms(founder, 'bio', 'long_bio', 'Ahmad Din has spent over 15 years at the intersection of real estate development and structured finance.')).split('\n\n');

  const expItems = (fc?.experience as string[]) ?? [
    '15+ years in real estate finance and development advisory',
    'Structured financing for projects across GCC, SEA, and international markets',
    'Built financial models for residential, hospitality, and mixed-use developments',
    'Worked with developers, sovereign funds, and institutional investors',
    'Founded Financial Modeler Pro to democratize professional-grade modeling',
  ];

  const projects = (fc?.projects as { id: string; title: string; description: string; sector: string; value: string }[]) ?? [];

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
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, marginBottom: 24 }}>{shortBio}</p>
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
      <section style={{ padding: '72px 40px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 }}>Background</h2>
        {longBio.map((para, i) => (
          <p key={i} style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8, marginBottom: 20 }}>{para}</p>
        ))}
      </section>

      {/* Experience */}
      <section style={{ padding: '0 40px 72px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 }}>Experience Highlights</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {expItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(27,79,138,0.3)', border: '1px solid rgba(27,79,138,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4A90D9', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, paddingTop: 4 }}>{item}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Projects */}
      {projects.length > 0 && (
        <section style={{ padding: '0 40px 72px', maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 }}>Notable Projects</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {projects.map(p => (
              <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>{p.title}</h3>
                  {p.sector && <span style={{ fontSize: 11, fontWeight: 600, color: '#4A90D9', background: 'rgba(27,79,138,0.2)', padding: '2px 10px', borderRadius: 12 }}>{p.sector}</span>}
                </div>
                {p.description && <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0 }}>{p.description}</p>}
                {p.value && <div style={{ fontSize: 12, color: '#1ABC9C', fontWeight: 600, marginTop: 8 }}>{p.value}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Philosophy */}
      <section style={{ padding: '64px 40px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 20 }}>Modeling Philosophy</h2>
          <blockquote style={{ borderLeft: '3px solid #1B4F8A', paddingLeft: 24, margin: 0, fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, fontStyle: 'italic' }}>
            &ldquo;{philosophy}&rdquo;
          </blockquote>
          <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>— {name}</div>
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
