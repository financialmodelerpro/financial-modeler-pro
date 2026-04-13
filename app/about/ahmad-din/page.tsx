import type { Metadata } from 'next';
import Link from 'next/link';
import { getFounderProfile, cms, getAllPageSections } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';

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
  const longBio    = (fc?.long_bio as string)       || cms(founder, 'bio', 'long_bio',   'Ahmad Din has spent over 15 years at the intersection of real estate development and structured finance. His career spans deal origination, feasibility analysis, development financing, and investor relations across the GCC, Southeast Asia, and international markets.\n\nBefore founding Financial Modeler Pro, Ahmad worked with major real estate developers and advisory firms, building financial models for projects ranging from luxury residential towers to large-scale mixed-use developments. He noticed that the same spreadsheet problems — inconsistent assumptions, untraceable errors, and hours spent reformatting for investor presentations — kept appearing on every engagement.\n\nFinancial Modeler Pro was built to solve that problem once and for all: a structured, professional-grade platform that produces audit-ready models and investor-ready outputs without the spreadsheet overhead.');
  const linkedin   = (fc?.cta_secondary_url as string) || (fc?.linkedin_url as string) || cms(founder, 'bio', 'linkedin_url', '');
  const philosophy = (fc?.philosophy as string)     || cms(founder, 'philosophy', 'text', 'A good financial model is not just a calculation — it\'s a communication tool. Every assumption should be visible, every output should be traceable, and the final product should be something you\'d be proud to present to a board or an investor committee without reformatting.');

  const expItems = (fc?.experience as string[]) ?? [
    cms(founder, 'experience', 'item_1', '15+ years in real estate finance and development advisory'),
    cms(founder, 'experience', 'item_2', 'Structured financing for projects across GCC, SEA, and international markets'),
    cms(founder, 'experience', 'item_3', 'Built financial models for residential, hospitality, and mixed-use developments'),
    cms(founder, 'experience', 'item_4', 'Worked with developers, sovereign funds, and institutional investors'),
    cms(founder, 'experience', 'item_5', 'Founded Financial Modeler Pro to democratize professional-grade modeling'),
  ].filter(Boolean);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '80px 40px 64px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 56, alignItems: 'center' }}>
          {/* Photo */}
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
          {/* Info */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Founder</div>
            <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 8, lineHeight: 1.1 }}>{name}</h1>
            {/* Title split on | */}
            <div style={{ marginBottom: 4 }}>
              {title.split('|').map((line, i) => (
                <div key={i} style={{ fontSize: i === 0 ? '1rem' : '0.95rem', color: i === 0 ? '#93C5FD' : '#1ABC9C', fontWeight: i === 0 ? 500 : 600, marginBottom: 2 }}>{line.trim()}</div>
              ))}
            </div>
            {quals && (
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em', marginBottom: 16, marginTop: 4 }}>{quals}</div>
            )}
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, marginBottom: 24 }}>{shortBio}</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href={`${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
                View Training Courses →
              </Link>
              {linkedin && (
                <a href={linkedin} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
                  LinkedIn ↗
                </a>
              )}
              {bookingUrl && (
                <Link href="/book-a-meeting" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1ABC9C', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
                  📅 Book a Meeting
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Long Bio */}
      <section style={{ padding: '72px 40px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 }}>Background</h2>
        {longBio.split('\n\n').map((para, i) => (
          <p key={i} style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8, marginBottom: 20 }}>{para}</p>
        ))}
      </section>

      {/* Experience */}
      <section style={{ padding: '0 40px 72px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 24 }}>Experience Highlights</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {expItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(27,79,138,0.3)', border: '1px solid rgba(27,79,138,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4A90D9', flexShrink: 0, marginTop: 1 }}>
                {i + 1}
              </div>
              <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, paddingTop: 4 }}>{item}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section style={{ padding: '64px 40px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 20 }}>Modeling Philosophy</h2>
          <blockquote style={{
            borderLeft: '3px solid #1B4F8A', paddingLeft: 24, margin: 0,
            fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, fontStyle: 'italic',
          }}>
            &ldquo;{philosophy}&rdquo;
          </blockquote>
          <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>— {name}</div>
        </div>
      </section>

      {/* CTAs */}
      <section style={{ padding: '72px 40px', maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 14 }}>Learn from Ahmad</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, marginBottom: 32 }}>
          Browse the free training library — video courses on real estate financial modeling taught from first principles.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1A7A30', color: '#fff', fontWeight: 700, fontSize: 14, padding: '12px 28px', borderRadius: 8, textDecoration: 'none' }}>
            Browse Free Courses →
          </Link>
          <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '12px 28px', borderRadius: 8, textDecoration: 'none' }}>
            Try the Platform →
          </Link>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Structured Modeling. Real-World Finance.</span>
      </footer>
    </div>
  );
}
