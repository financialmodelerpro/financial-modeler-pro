/**
 * /modeling-hub/[platformSlug]/[moduleSlug]
 *
 * Per-module marketing page. Reads the module + its visible page sections
 * (hero / features / how_it_works / cta / testimonials) and renders a
 * structured landing page for that single module.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { getCmsContent, cms } from '@/src/shared/cms';
import {
  getPlatformModuleWithPages,
  getSectionContent,
  type HeroContent,
  type FeaturesContent,
  type HowItWorksContent,
  type CtaContent,
  type TestimonialsContent,
} from '@/src/shared/cms/platform-modules';

export const revalidate = 60;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export async function generateMetadata(props: {
  params: Promise<{ platformSlug: string; moduleSlug: string }>;
}): Promise<Metadata> {
  const { platformSlug, moduleSlug } = await props.params;
  const data = await getPlatformModuleWithPages(platformSlug, moduleSlug);
  if (!data) return { title: 'Module' };
  const hero = getSectionContent<HeroContent>(data.pages, 'hero');
  return {
    title: `${data.name}, Financial Modeler Pro`,
    description: hero?.subtitle ?? data.description,
    alternates: { canonical: `${MAIN_URL}/modeling-hub/${platformSlug}/${moduleSlug}` },
  };
}

export default async function ModuleMarketingPage(props: {
  params: Promise<{ platformSlug: string; moduleSlug: string }>;
}) {
  const { platformSlug, moduleSlug } = await props.params;
  const [data, content] = await Promise.all([
    getPlatformModuleWithPages(platformSlug, moduleSlug),
    getCmsContent(),
  ]);
  if (!data) notFound();
  const footerCompany = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder = cms(content, 'footer', 'founder_line', 'Ahmad Din, CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  const hero = getSectionContent<HeroContent>(data.pages, 'hero');
  const features = getSectionContent<FeaturesContent>(data.pages, 'features');
  const howItWorks = getSectionContent<HowItWorksContent>(data.pages, 'how_it_works');
  const cta = getSectionContent<CtaContent>(data.pages, 'cta');
  const testimonials = getSectionContent<TestimonialsContent>(data.pages, 'testimonials');

  return (
    <>
      <NavbarServer />
      <main>
        {/* ── Hero ── */}
        <section
          data-testid="module-hero"
          style={{
            background: 'linear-gradient(135deg, #1B3A6B 0%, #1B4F8A 100%)',
            color: '#fff',
            padding: '80px 24px 60px',
          }}
        >
          <div style={{ maxWidth: 980, margin: '0 auto' }}>
            <Link
              href={`/modeling-hub/${platformSlug}`}
              style={{ fontSize: 13, color: '#BFDBFE', textDecoration: 'none', display: 'inline-block', marginBottom: 18 }}
            >
              ← {platformSlug.toUpperCase()}
            </Link>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#BFDBFE', marginBottom: 8 }}>
              MODULE {data.number}
            </div>
            <h1 style={{ fontSize: 44, fontWeight: 800, marginBottom: 18, lineHeight: 1.1 }}>
              {hero?.title ?? data.name}
            </h1>
            <p style={{ fontSize: 18, color: '#E5E7EB', maxWidth: 760, marginBottom: 28 }}>
              {hero?.subtitle ?? data.description}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {hero?.primaryCta?.href && (
                <Link
                  href={hero.primaryCta.href}
                  data-testid="hero-primary-cta"
                  style={{
                    fontSize: 14, fontWeight: 700, padding: '14px 28px', borderRadius: 8,
                    background: '#fff', color: '#1B3A6B', textDecoration: 'none',
                  }}
                >
                  {hero.primaryCta.label}
                </Link>
              )}
              {hero?.secondaryCta?.href && (
                <Link
                  href={hero.secondaryCta.href}
                  data-testid="hero-secondary-cta"
                  style={{
                    fontSize: 14, fontWeight: 700, padding: '14px 28px', borderRadius: 8,
                    background: 'transparent', color: '#fff', border: '1px solid #fff', textDecoration: 'none',
                  }}
                >
                  {hero.secondaryCta.label}
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        {features && features.bullets.length > 0 && (
          <section
            data-testid="module-features"
            style={{ background: '#F4F7FC', padding: '60px 24px' }}
          >
            <div style={{ maxWidth: 980, margin: '0 auto' }}>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>
                {features.heading}
              </h2>
              <ul
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 12,
                  listStyle: 'none',
                  padding: 0,
                }}
              >
                {features.bullets.map((b, i) => (
                  <li
                    key={i}
                    style={{
                      background: '#fff',
                      padding: '16px 20px',
                      borderRadius: 10,
                      border: '1px solid #E8F0FB',
                      fontSize: 14,
                      color: '#1B3A6B',
                      display: 'flex',
                      gap: 10,
                    }}
                  >
                    <span style={{ color: '#1A7A30' }}>✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── How it works ── */}
        {howItWorks && howItWorks.steps.length > 0 && (
          <section
            data-testid="module-how-it-works"
            style={{ background: '#fff', padding: '60px 24px' }}
          >
            <div style={{ maxWidth: 980, margin: '0 auto' }}>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1B3A6B', marginBottom: 28 }}>
                {howItWorks.heading}
              </h2>
              <ol style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {howItWorks.steps.map((s) => (
                  <li
                    key={s.number}
                    style={{
                      background: '#F4F7FC',
                      padding: 20,
                      borderRadius: 10,
                      border: '1px solid #E8F0FB',
                      display: 'grid',
                      gridTemplateColumns: '48px 1fr',
                      gap: 16,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: '#1B4F8A', color: '#fff', fontWeight: 800, fontSize: 18,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {s.number}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
                        {s.title}
                      </div>
                      <div style={{ fontSize: 13, color: '#6B7280' }}>{s.body}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* ── Testimonials ── */}
        {testimonials && testimonials.items.length > 0 && (
          <section
            data-testid="module-testimonials"
            style={{ background: '#F4F7FC', padding: '60px 24px' }}
          >
            <div style={{ maxWidth: 980, margin: '0 auto' }}>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1B3A6B', marginBottom: 28 }}>
                {testimonials.heading}
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                {testimonials.items.map((t, i) => (
                  <blockquote
                    key={i}
                    style={{
                      background: '#fff', padding: 20, borderRadius: 10, border: '1px solid #E8F0FB',
                      margin: 0,
                    }}
                  >
                    <p style={{ fontSize: 14, color: '#1B3A6B', marginBottom: 12, fontStyle: 'italic' }}>
                      "{t.quote}"
                    </p>
                    <footer style={{ fontSize: 12, color: '#6B7280' }}>
                      <strong style={{ color: '#1B3A6B' }}>{t.author}</strong>
                      {t.role && <span>, {t.role}</span>}
                      {t.company && <span> at {t.company}</span>}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── CTA ── */}
        {cta && (
          <section
            data-testid="module-cta"
            style={{
              background: 'linear-gradient(135deg, #1B3A6B 0%, #1B4F8A 100%)',
              color: '#fff',
              padding: '80px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 14 }}>{cta.heading}</h2>
              <p style={{ fontSize: 16, color: '#E5E7EB', marginBottom: 28 }}>{cta.body}</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                {cta.primaryCta?.href && (
                  <Link
                    href={cta.primaryCta.href}
                    style={{
                      fontSize: 14, fontWeight: 700, padding: '14px 28px', borderRadius: 8,
                      background: '#fff', color: '#1B3A6B', textDecoration: 'none',
                    }}
                  >
                    {cta.primaryCta.label}
                  </Link>
                )}
                {cta.secondaryCta?.href && (
                  <Link
                    href={cta.secondaryCta.href}
                    style={{
                      fontSize: 14, fontWeight: 700, padding: '14px 28px', borderRadius: 8,
                      background: 'transparent', color: '#fff', border: '1px solid #fff', textDecoration: 'none',
                    }}
                  >
                    {cta.secondaryCta.label}
                  </Link>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </>
  );
}
