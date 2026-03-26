import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { COURSES } from '@/src/config/courses';
import { getCmsContent, cms } from '@/src/lib/cms';
import { CurriculumCard } from './CurriculumCard';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Training Hub — Free Financial Modeling Certification | Financial Modeler Pro',
  description: 'Get certified in financial modeling for free. Professional certification backed by real practitioner training. Certificates issued via Certifier.io.',
};

// ── Static data ───────────────────────────────────────────────────────────────

const STEPS = [
  { icon: '📝', label: 'Register Free',     desc: 'Create your free training account in seconds' },
  { icon: '▶️', label: 'Watch on YouTube',  desc: 'Stream all sessions free on YouTube' },
  { icon: '✍️', label: 'Take Assessment',   desc: 'Complete the quiz at the end of each session' },
  { icon: '✅', label: 'Pass Sessions',     desc: 'Score 70%+ to unlock the next session' },
  { icon: '🏆', label: 'Get Certified',     desc: 'Pass the final exam and receive your certificate' },
];

const BENEFITS = [
  {
    icon: '🎓',
    title: 'Verifiable Certificate',
    desc: 'Each certificate has a unique ID that employers can verify instantly at certifier.io.',
  },
  {
    icon: '💼',
    title: 'LinkedIn Badge',
    desc: 'Add your certificate directly to your LinkedIn profile with one click.',
  },
  {
    icon: '📊',
    title: 'Proof of Competence',
    desc: 'Demonstrate real, assessed financial modeling skills — not just course completion.',
  },
  {
    icon: '🆓',
    title: 'Always Free',
    desc: 'No fees, no subscriptions, no paywalls. Every course and certificate is 100% free.',
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TrainingPage() {
  const sfm = COURSES['3sfm'];
  const bvm = COURSES['bvm'];
  const content = await getCmsContent();

  const heroBadge       = cms(content, 'training_page', 'hero_badge',         '🎓 Free Certification Program');
  const heroHeadline    = cms(content, 'training_page', 'hero_headline',       'Get Certified in Financial Modeling — Free');
  const heroSub         = cms(content, 'training_page', 'hero_sub',            'Professional certification backed by real practitioner training. 100% free. Always.');
  const ctaPrimary      = cms(content, 'training_page', 'cta_primary',         'Register Free →');
  const ctaSecondary    = cms(content, 'training_page', 'cta_secondary',       'Login to Dashboard →');
  const bottomCtaH2     = cms(content, 'training_page', 'bottom_cta_heading',  'Ready to get certified?');
  const bottomCtaSub    = cms(content, 'training_page', 'bottom_cta_sub',      'Join hundreds of finance professionals building verified skills — completely free.');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* ── Section 1 — Hero ──────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        padding: 'clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)',
        textAlign: 'center',
        color: '#fff',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: '#6EE589', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
          }}>
            {heroBadge}
          </div>

          <h1 style={{
            fontSize: 'clamp(28px,5vw,52px)', fontWeight: 800, color: '#fff',
            lineHeight: 1.15, marginBottom: 20, letterSpacing: '-0.02em',
          }}>
            {heroHeadline}
          </h1>

          <p style={{
            fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px',
          }}>
            {heroSub}
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/training/register" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#2EAA4A', color: '#fff',
              fontWeight: 700, fontSize: 15, padding: '13px 32px',
              borderRadius: 8, textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(46,170,74,0.4)',
            }}>
              {ctaPrimary}
            </Link>
            <Link href="/training/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: '#fff',
              fontWeight: 700, fontSize: 15, padding: '13px 32px',
              borderRadius: 8, textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.35)',
            }}>
              {ctaSecondary}
            </Link>
          </div>

          <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            Already registered?{' '}
            <Link href="/training/login" style={{ color: '#6EE589', textDecoration: 'none', fontWeight: 600 }}>
              Login →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Section 2 — Course Cards ──────────────────────────────────────── */}
      <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              Available Courses
            </div>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
              Choose Your Certification Path
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 28 }}>
            <CurriculumCard
              course={sfm}
              accentColor="#1B4F8A"
              badgeBg="#EEF2FF"
              badgeColor="#4F46E5"
              badgeBorder="#C7D2FE"
              sessionLabel={`${sfm.sessions.filter(s => !s.isFinal).length} Sessions`}
            />
            <CurriculumCard
              course={bvm}
              accentColor="#2EAA4A"
              badgeBg="#F0FFF4"
              badgeColor="#15803D"
              badgeBorder="#BBF7D0"
              sessionLabel={`${bvm.sessions.filter(s => !s.isFinal).length} Lessons`}
            />
          </div>
        </div>
      </section>

      {/* ── Section 3 — How It Works ──────────────────────────────────────── */}
      <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              The Process
            </div>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
              How It Works
            </h2>
          </div>

          <div style={{
            display: 'flex', gap: 0,
            alignItems: 'flex-start', justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {STEPS.map((step, i) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
                {/* Step card */}
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

                {/* Arrow connector — not after last step */}
                {i < STEPS.length - 1 && (
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

      {/* ── Section 4 — Why Get Certified ────────────────────────────────── */}
      <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              Why Certify
            </div>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
              Why Get Certified?
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 24 }}>
            {BENEFITS.map((b) => (
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

      {/* ── Section 5 — Certifier.io Trust ───────────────────────────────── */}
      <section style={{ background: '#E8F7EC', padding: 'clamp(40px,6vw,64px) 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: '#fff', border: '1px solid #BBF7D0',
            borderRadius: 10, padding: '10px 20px', marginBottom: 24,
            boxShadow: '0 2px 8px rgba(46,170,74,0.1)',
          }}>
            <span style={{ fontSize: 20 }}>🏅</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#15803D' }}>
              Certifier.io
            </span>
          </div>

          <h2 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 14 }}>
            Trusted Certificate Verification
          </h2>
          <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 24 }}>
            All certificates are issued and verified via{' '}
            <strong>Certifier.io</strong>. Each certificate has a unique, permanent verification
            link. Employers and institutions can verify your certification at certifier.io
            at any time.
          </p>
          <a
            href="https://certifier.io"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              color: '#15803D', fontWeight: 700, fontSize: 13,
              textDecoration: 'none', border: '1.5px solid #2EAA4A',
              padding: '9px 20px', borderRadius: 7,
              background: '#fff',
            }}
          >
            Verify a Certificate →
          </a>
        </div>
      </section>

      {/* ── Section 6 — Bottom CTA ────────────────────────────────────────── */}
      <section style={{
        background: '#2EAA4A',
        padding: 'clamp(48px,7vw,80px) 40px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800,
            color: '#fff', marginBottom: 12, lineHeight: 1.2,
          }}>
            {bottomCtaH2}
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', marginBottom: 36, lineHeight: 1.6 }}>
            {bottomCtaSub}
          </p>
          <Link href="/training/register" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#fff', color: '#1A7A30',
            fontWeight: 800, fontSize: 16, padding: '14px 40px',
            borderRadius: 8, textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            Register Free →
          </Link>
          <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            Already registered?{' '}
            <Link href="/training/login" style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>
              Login to Dashboard →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{
        background: '#0D2E5A',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '24px 40px',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
          © {new Date().getFullYear()} Financial Modeler Pro
        </span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>← Home</Link>
          <Link href="/training/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</Link>
          <Link href="/training/register" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Register</Link>
        </div>
      </footer>
    </div>
  );
}
