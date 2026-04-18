// v-cms-training-066
import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { COURSES } from '@/src/config/courses';
import { getCmsContent, cms, getTestimonialsForPage, getAllPageSections } from '@/src/lib/shared/cms';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getServerClient } from '@/src/lib/shared/supabase';
import { CmsField, cmsVisible } from '@/src/components/cms/CmsField';
import { CurriculumCard, type CourseDescription } from './CurriculumCard';
import { TestimonialsCarousel } from './TestimonialsCarousel';
import { UpcomingSessionsPreview } from './UpcomingSessionsPreview';

export const revalidate = 0;

// Per-field width + alignment style from admin VF keys (e.g. h.subtitle_align,
// h.subtitle_width). Returns a React.CSSProperties patch to merge into the
// field's existing inline style.
function fw(record: Record<string, unknown> | undefined, key: string): React.CSSProperties {
  const align = record?.[`${key}_align`] as string | undefined;
  const width = record?.[`${key}_width`] as string | undefined;
  const style: React.CSSProperties = {};
  if (align) style.textAlign = align as React.CSSProperties['textAlign'];
  if (width && width !== 'auto' && width !== '100%' && width !== '100') {
    style.maxWidth = width.endsWith('%') ? width : `${width}%`;
    style.marginLeft = 'auto';
    style.marginRight = 'auto';
  } else if (width === 'auto') {
    style.maxWidth = 'none';
  }
  return style;
}

export const metadata: Metadata = {
  title: 'Training Hub - Free Financial Modeling Certification | Financial Modeler Pro',
  description: 'Get certified in financial modeling for free. Professional certification backed by real practitioner training. Verified certificates with unique IDs.',
};

// ── Static fallback data ─────────────────────────────────────────────────────

const STEPS = [
  { icon: '📝', label: 'Register Free',     desc: 'Create your free training account in seconds' },
  { icon: '▶️', label: 'Watch on YouTube',  desc: 'Stream all sessions free on YouTube' },
  { icon: '✍️', label: 'Take Assessment',   desc: 'Complete the quiz at the end of each session' },
  { icon: '✅', label: 'Pass Sessions',     desc: 'Score 70%+ to unlock the next session' },
  { icon: '🏆', label: 'Get Certified',     desc: 'Pass the final exam and receive your certificate' },
];

const BENEFITS = [
  { icon: '🎓', title: 'Verifiable Certificate', desc: 'Each certificate has a unique ID that employers can verify instantly online.' },
  { icon: '💼', title: 'LinkedIn Badge',          desc: 'Add your certificate directly to your LinkedIn profile with one click.' },
  { icon: '📊', title: 'Proof of Competence',     desc: 'Demonstrate real, assessed financial modeling skills - not just course completion.' },
  { icon: '🆓', title: 'Always Free',             desc: 'No fees, no subscriptions, no paywalls. Every course and certificate is 100% free.' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCourseDescriptions(): Promise<Record<string, CourseDescription>> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('courses')
      .select('category, tagline, full_description, what_you_learn, prerequisites, who_is_this_for, skill_level, duration_hours, language, certificate_description');
    if (!data) return {};
    const map: Record<string, CourseDescription> = {};
    for (const row of data as Record<string, unknown>[]) {
      const cat = ((row.category as string) ?? '').toLowerCase();
      if (cat) {
        map[cat] = {
          tagline:                row.tagline as string | undefined,
          fullDescription:        row.full_description as string | undefined,
          whatYouLearn:           Array.isArray(row.what_you_learn) ? (row.what_you_learn as string[]) : [],
          prerequisites:          row.prerequisites as string | undefined,
          whoIsThisFor:           row.who_is_this_for as string | undefined,
          skillLevel:             row.skill_level as string | undefined,
          durationHours:          row.duration_hours as number | undefined,
          language:               row.language as string | undefined,
          certificateDescription: row.certificate_description as string | undefined,
        };
      }
    }
    return map;
  } catch {
    return {};
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function TrainingPage() {
  const sfm = COURSES['3sfm'];
  const bvm = COURSES['bvm'];
  const [content, descriptions, testimonials, cmsSections] = await Promise.all([
    getCmsContent(),
    getCourseDescriptions(),
    getTestimonialsForPage('training'),
    getAllPageSections('training'),
  ]);

  // ── Extract CMS sections (including hidden ones) ─────────────────────────
  const findSection = (type: string, dynamic?: string) =>
    cmsSections.find(s => {
      if (s.section_type !== type) return false;
      if (dynamic) return (s.content as Record<string, unknown>)?._dynamic === dynamic;
      return !(s.content as Record<string, unknown>)?._dynamic;
    });

  const heroRaw      = findSection('hero');
  const coursesRaw   = findSection('cards', 'courses');
  const stepsRaw     = findSection('timeline');
  const benefitsRaw  = findSection('cards');
  const certRaw      = findSection('banner');
  const sessionsRaw  = findSection('embed', 'upcoming_sessions');
  const testimRaw    = findSection('testimonials', 'testimonials');
  const submitCtaRaw = cmsSections.find(s => s.section_type === 'cta' && s.display_order < 9);
  const bottomCtaRaw = cmsSections.find(s => s.section_type === 'cta' && s.display_order >= 9);

  // Helpers
  const fc = (raw: typeof heroRaw) => raw?.visible !== false ? raw?.content as Record<string, unknown> | undefined : undefined;
  const fs = (raw: typeof heroRaw) => raw?.visible !== false ? raw?.styles as Record<string, unknown> | undefined : undefined;
  const hidden = (raw: typeof heroRaw) => raw?.visible === false;

  // ── CMS values with fallbacks ────────────────────────────────────────────
  const h = fc(heroRaw);
  const heroBadge    = (h?.badge as string)    || cms(content, 'training_page', 'hero_badge',    '🎓 Free Certification Program');
  const heroHeadline = (h?.headline as string) || cms(content, 'training_page', 'hero_headline', 'Get Certified in Financial Modeling - Free');
  const heroSub      = (h?.subtitle as string) || cms(content, 'training_page', 'hero_sub',      'Professional certification backed by real practitioner training. 100% free. Always.');
  const ctaPrimary   = (h?.cta_primary_text as string) || (h?.cta1Text as string) || cms(content, 'training_page', 'cta_primary',   'Register Free →');
  const ctaPriUrl    = (h?.cta_primary_url as string)  || (h?.cta1Url as string)  || '/register';
  const ctaSecondary = (h?.cta_secondary_text as string) || (h?.cta2Text as string) || cms(content, 'training_page', 'cta_secondary', 'Login to Dashboard →');
  const ctaSecUrl    = (h?.cta_secondary_url as string)  || (h?.cta2Url as string)  || '/signin';

  const cc = fc(coursesRaw);
  const coursesBadge   = (cc?.badge as string)   || 'Available Courses';
  const coursesHead   = (cc?.heading as string)  || 'Choose Your Certification Path';

  const sc = fc(stepsRaw);
  const stepsBadge  = (sc?.badge as string)   || 'The Process';
  const stepsHead   = (sc?.heading as string) || 'How It Works';
  const stepsItems  = (sc?.steps as typeof STEPS) || STEPS;

  const bc = fc(benefitsRaw);
  const benefitsBadge = (bc?.badge as string)   || 'Why Certify';
  const benefitsHead  = (bc?.heading as string) || 'Why Get Certified?';
  const benefitsItems = (bc?.benefits as typeof BENEFITS) || BENEFITS;

  const vc = fc(certRaw);
  const vs = fs(certRaw);
  const certIcon    = (vc?.icon as string)        || '🏅';
  const certBadge   = (vc?.badge_text as string)  || 'Verified Certificates';
  const certHead    = (vc?.heading as string)     || 'Trusted Certificate Verification';
  const certDesc    = (vc?.description as string) || 'All certificates are issued with a unique Certificate ID and QR code. Each certificate has a permanent verification link. Employers and institutions can verify your certification online at any time.';
  const certCtaText = (vc?.cta_text as string)    || 'Verify a Certificate →';
  const certCtaUrl  = (vc?.cta_url as string)     || '/verify';
  const certBg      = (vs?.bgColor as string)     || '#E8F7EC';

  const tc = fc(testimRaw);
  const testimH2  = (tc?.heading as string)    || cms(content, 'training_page', 'testimonials_heading', 'What Our Students Say');
  const testimSub = (tc?.subheading as string) || cms(content, 'training_page', 'testimonials_sub',     'Verified feedback from FMP Training Hub students.');

  const sc2 = fc(submitCtaRaw);
  const submitBadge   = (sc2?.badge as string)       || 'Your Voice Matters';
  const submitHead    = (sc2?.heading as string)      || 'Completed a Course? Share Your Story';
  const submitDesc    = (sc2?.description as string)  || 'Help other learners by sharing your experience. Your testimonial could inspire the next finance professional.';
  const submitCtaText = (sc2?.cta_text as string)     || '⭐ Submit Your Testimonial';
  const submitCtaUrl  = (sc2?.cta_url as string)      || '/training/submit-testimonial';

  const bc2 = fc(bottomCtaRaw);
  const bottomH2       = (bc2?.heading as string)     || cms(content, 'training_page', 'bottom_cta_heading', 'Ready to get certified?');
  const bottomSub      = (bc2?.description as string) || cms(content, 'training_page', 'bottom_cta_sub',     'Join hundreds of finance professionals building verified skills - completely free.');
  const bottomCtaText  = (bc2?.cta_text as string)    || 'Register Free →';
  const bottomCtaUrl   = (bc2?.cta_url as string)     || '/register';
  const bottomLoginH   = (bc2?.login_hint as string)  || 'Already registered?';
  const bottomLoginT   = (bc2?.login_text as string)  || 'Login to Dashboard →';
  const bottomLoginU   = (bc2?.login_url as string)   || '/signin';

  // Bottom CTA visibility: check CMS section visible, then fall back to old cms_content toggle
  const bottomCtaVisible = bottomCtaRaw
    ? bottomCtaRaw.visible !== false
    : cms(content, 'cta', 'section_visible', 'true') !== 'false';

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din - CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright',    `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* ── Section 1 - Hero ──────────────────────────────────────────────── */}
      {!hidden(heroRaw) && (
        <section style={{
          background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
          padding: 'clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {cmsVisible(h ?? {}, 'badge') && (
              <div style={{
                ...fw(h, 'badge'),
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)',
                borderRadius: 20, padding: '5px 16px', fontSize: 12,
                color: '#6EE589', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
              }}>
                {heroBadge}
              </div>
            )}

            {cmsVisible(h ?? {}, 'headline') && (
              <h1 style={{
                fontSize: 'clamp(28px,5vw,52px)', fontWeight: 800, color: '#fff',
                lineHeight: 1.15, marginBottom: 20, letterSpacing: '-0.02em',
                ...fw(h, 'headline'),
              }}>
                {heroHeadline}
              </h1>
            )}

            <CmsField
              content={h ?? { subtitle: heroSub }}
              field="subtitle"
              as="p"
              style={{
                fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.6)',
                lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px',
              }}
            />

            {(cmsVisible(h ?? {}, 'cta_primary') && ctaPrimary.trim() && ctaPriUrl) || (cmsVisible(h ?? {}, 'cta_secondary') && ctaSecondary.trim() && ctaSecUrl) ? (
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                {cmsVisible(h ?? {}, 'cta_primary') && ctaPrimary.trim() && ctaPriUrl && (
                  <Link href={ctaPriUrl} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: '#2EAA4A', color: '#fff',
                    fontWeight: 700, fontSize: 15, padding: '13px 32px',
                    borderRadius: 8, textDecoration: 'none',
                    boxShadow: '0 4px 20px rgba(46,170,74,0.4)',
                  }}>
                    {ctaPrimary}
                  </Link>
                )}
                {cmsVisible(h ?? {}, 'cta_secondary') && ctaSecondary.trim() && ctaSecUrl && (
                  <Link href={ctaSecUrl} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'transparent', color: '#fff',
                    fontWeight: 700, fontSize: 15, padding: '13px 32px',
                    borderRadius: 8, textDecoration: 'none',
                    border: '2px solid rgba(255,255,255,0.35)',
                  }}>
                    {ctaSecondary}
                  </Link>
                )}
              </div>
            ) : null}

          </div>
        </section>
      )}

      {/* ── Section 2 - Course Cards ──────────────────────────────────────── */}
      {!hidden(coursesRaw) && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              {cmsVisible(cc ?? {}, 'badge') && (
                <div style={{ ...fw(cc, 'badge'), fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  {coursesBadge}
                </div>
              )}
              {cmsVisible(cc ?? {}, 'heading') && (
                <h2 style={{ ...fw(cc, 'heading'), fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
                  {coursesHead}
                </h2>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 28 }}>
              <CurriculumCard
                course={sfm}
                accentColor="#1B4F8A"
                badgeBg="#EEF2FF"
                badgeColor="#4F46E5"
                badgeBorder="#C7D2FE"
                sessionLabel={`${sfm.sessions.filter(s => !s.isFinal).length} Sessions`}
                description={descriptions['3sfm']}
              />
              <CurriculumCard
                course={bvm}
                accentColor="#2EAA4A"
                badgeBg="#F0FFF4"
                badgeColor="#15803D"
                badgeBorder="#BBF7D0"
                sessionLabel={`${bvm.sessions.filter(s => !s.isFinal).length} Lessons`}
                description={descriptions['bvm']}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Section 3 - How It Works ──────────────────────────────────────── */}
      {!hidden(stepsRaw) && (
        <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              {cmsVisible(sc ?? {}, 'badge') && (
                <div style={{ ...fw(sc, 'badge'), fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  {stepsBadge}
                </div>
              )}
              {cmsVisible(sc ?? {}, 'heading') && (
                <h2 style={{ ...fw(sc, 'heading'), fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
                  {stepsHead}
                </h2>
              )}
            </div>

            <div style={{
              display: 'flex', gap: 0,
              alignItems: 'flex-start', justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              {stepsItems.map((step, i) => (
                <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    textAlign: 'center', width: 160, padding: '0 8px',
                  }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '50%',
                      background: '#fff', border: '2px solid #D1FAE5',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 26, marginBottom: 14,
                      boxShadow: '0 2px 12px rgba(46,170,74,0.12)',
                    }}>
                      {step.icon}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>
                      {step.label}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#6B7280', lineHeight: 1.5 }}>
                      {step.desc}
                    </div>
                  </div>
                  {i < stepsItems.length - 1 && (
                    <div style={{
                      fontSize: 20, color: '#2EAA4A', fontWeight: 700,
                      marginTop: 20, padding: '0 4px', flexShrink: 0,
                    }}>
                      →
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 4 - Why Get Certified ────────────────────────────────── */}
      {!hidden(benefitsRaw) && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              {cmsVisible(bc ?? {}, 'badge') && (
                <div style={{ ...fw(bc, 'badge'), fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  {benefitsBadge}
                </div>
              )}
              {cmsVisible(bc ?? {}, 'heading') && (
                <h2 style={{ ...fw(bc, 'heading'), fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
                  {benefitsHead}
                </h2>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 24 }}>
              {benefitsItems.map((b) => (
                <div key={b.title} style={{
                  background: '#F9FAFB', borderRadius: 12,
                  border: '1px solid #E5E7EB',
                  padding: '28px 22px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 14 }}>{b.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>
                    {b.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6 }}>
                    {b.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 5 - Certificate Verification ────────────────────────── */}
      {!hidden(certRaw) && (
        <section style={{ background: certBg, padding: 'clamp(40px,6vw,64px) 40px', textAlign: 'center' }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            {cmsVisible(vc ?? {}, 'badge_text') && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: '#fff', border: '1px solid #BBF7D0',
                borderRadius: 10, padding: '10px 20px', marginBottom: 24,
                boxShadow: '0 2px 8px rgba(46,170,74,0.1)',
              }}>
                <span style={{ fontSize: 20 }}>{certIcon}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#15803D' }}>
                  {certBadge}
                </span>
              </div>
            )}

            {cmsVisible(vc ?? {}, 'heading') && (
              <h2 style={{ ...fw(vc, 'heading'), fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 14 }}>
                {certHead}
              </h2>
            )}
            <CmsField
              content={vc ?? { description: certDesc }}
              field="description"
              as="p"
              style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 24 }}
            />
            {cmsVisible(vc ?? {}, 'cta_text') && certCtaText && certCtaUrl && (
              <Link
                href={certCtaUrl}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  color: '#15803D', fontWeight: 700, fontSize: 13,
                  textDecoration: 'none', border: '1.5px solid #2EAA4A',
                  padding: '9px 20px', borderRadius: 7,
                  background: '#fff',
                }}
              >
                {certCtaText}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Section 6 - Upcoming Sessions ─────────────────────────────────── */}
      {!hidden(sessionsRaw) && <UpcomingSessionsPreview />}

      {/* ── Section 7 - Testimonials ──────────────────────────────────────── */}
      {!hidden(testimRaw) && (
        <TestimonialsCarousel
          testimonials={testimonials}
          heading={testimH2}
          subheading={testimSub}
        />
      )}

      {/* ── Section 8 - Submit Testimonial CTA ────────────────────────────── */}
      {!hidden(submitCtaRaw) && (
        <section style={{ background: '#F0F4FF', padding: 'clamp(32px,5vw,56px) 40px', textAlign: 'center', borderTop: '1px solid #E0E7F8', borderBottom: '1px solid #E0E7F8' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {cmsVisible(sc2 ?? {}, 'badge') && (
              <div style={{ ...fw(sc2, 'badge'), fontSize: 11, fontWeight: 700, color: '#4F46E5', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                {submitBadge}
              </div>
            )}
            {cmsVisible(sc2 ?? {}, 'heading') && (
              <h2 style={{ ...fw(sc2, 'heading'), fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>
                {submitHead}
              </h2>
            )}
            <CmsField
              content={sc2 ?? { description: submitDesc }}
              field="description"
              as="p"
              style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, marginBottom: 24 }}
            />
            {cmsVisible(sc2 ?? {}, 'cta_text') && submitCtaText && submitCtaUrl && (
              <Link href={submitCtaUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '12px 28px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 16px rgba(27,79,138,0.25)' }}>
                {submitCtaText}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Section 9 - Bottom CTA ────────────────────────────────────────── */}
      {bottomCtaVisible && (
        <section style={{ background: '#2EAA4A', padding: 'clamp(48px,7vw,80px) 40px', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            {cmsVisible(bc2 ?? {}, 'heading') && (
              <h2 style={{ ...fw(bc2, 'heading'), fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
                {bottomH2}
              </h2>
            )}
            <CmsField
              content={bc2 ?? { description: bottomSub }}
              field="description"
              as="p"
              style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', marginBottom: 36, lineHeight: 1.6 }}
            />
            {cmsVisible(bc2 ?? {}, 'cta_text') && bottomCtaText && bottomCtaUrl && (
              <Link href={bottomCtaUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1A7A30', fontWeight: 800, fontSize: 16, padding: '14px 40px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                {bottomCtaText}
              </Link>
            )}
            {cmsVisible(bc2 ?? {}, 'login_text') && bottomLoginT && bottomLoginU && (
              <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {bottomLoginH}{' '}
                <Link href={bottomLoginU} style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>
                  {bottomLoginT}
                </Link>
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
