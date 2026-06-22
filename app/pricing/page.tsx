import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getCmsContent, cms, getAllPageSections } from '@/src/shared/cms';
import { getServerClient } from '@/src/core/db/supabase';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { PricingAccordion } from '@/src/hubs/main/components/pricing/PricingAccordion';
import LivePlanCards from '@/src/hubs/main/components/pricing/LivePlanCards';
import { loadPricingCatalog, visibleForCustomers } from '@/src/shared/entitlements/pricingCatalog';
import { CouponInput } from './CouponInput';

export const revalidate = 0;

const MAIN_URL_PR = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Pricing | Financial Modeler Pro',
  description: 'Flexible pricing for Financial Modeler Pro Training Hub and Modeling Hub platforms. Professional financial modeling training and institutional-grade modeling tools. Start free, upgrade when ready.',
  alternates: { canonical: `${MAIN_URL_PR}/pricing` },
};

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export default async function PricingPage() {
  const [content, pricingSections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('pricing'),
  ]);
  const sb = getServerClient();

  // LIVE plan cards + comparison come from the entitlement tables (the single
  // source of truth), NOT the old platform_pricing table. loadPricingCatalog
  // runs server-side with the service-role client, so it works for an
  // unauthenticated visitor. Hidden non-module features are filtered out.
  const pricing = await loadPricingCatalog(sb, 'real-estate');
  const livePlans = pricing.plans;
  const liveFeatures = visibleForCustomers(pricing.features);
  const liveCoverage = pricing.coverage;
  const trialDays = pricing.trialDays;

  // CMS, hero + FAQ sourced from page_sections (Page Builder is canonical).
  const heroSection = pricingSections.find(s => s.section_type === 'hero' && s.visible !== false);
  const heroContent = (heroSection?.content ?? {}) as Record<string, unknown>;
  const heroBadge    = (heroContent.badge    as string | undefined) ?? 'Pricing';
  const heroTitle    = (heroContent.headline as string | undefined) ?? 'Simple, Transparent Pricing';
  const heroSubtitle = (heroContent.subtitle as string | undefined) ?? 'Professional financial modeling tools. Start free, upgrade when ready.';

  const faqSection = pricingSections.find(s => s.section_type === 'faq' && s.visible !== false);
  const faqContent = (faqSection?.content ?? {}) as Record<string, unknown>;
  const faqHeading = (faqContent.heading as string | undefined) ?? 'Frequently Asked Questions';
  const rawFaqItems = (faqContent.items as { question: string; answer: string; visible?: boolean }[] | undefined) ?? [];
  const faqs: { question: string; answer: string }[] = rawFaqItems
    .filter(f => f.visible !== false)
    .map(f => ({ question: f.question, answer: f.answer }));

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Financial Modeler Pro Team');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero (FMP navy + orange; text from Page Builder) */}
      <section style={{ position: 'relative', background: 'radial-gradient(1200px 400px at 50% -10%, #163a6b 0%, #0D2E5A 45%, #0A2448 100%)', padding: 'clamp(64px, 9vw, 96px) 40px clamp(56px, 7vw, 72px)', textAlign: 'center', color: '#fff', overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 220, height: 4, background: 'linear-gradient(90deg, #F97316, #EA580C)' }} />
        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, color: '#FFE7D1', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 18, padding: '6px 14px', borderRadius: 999, background: 'rgba(249,115,22,0.16)', border: '1px solid rgba(249,115,22,0.35)' }}>{heroBadge}</div>
          <h1 style={{ fontSize: 'clamp(30px, 4.6vw, 52px)', fontWeight: 900, color: '#fff', marginBottom: 16, lineHeight: 1.08, letterSpacing: '-0.02em' }}>{heroTitle}</h1>
          <p style={{ fontSize: 'clamp(15px, 1.7vw, 18px)', color: 'rgba(255,255,255,0.72)', lineHeight: 1.65, maxWidth: 560, margin: '0 auto' }}>{heroSubtitle}</p>
        </div>
      </section>

      {/* Training Hub Banner */}
      <section style={{ background: '#F0FDF4', padding: '24px 40px', borderBottom: '1px solid #BBF7D0' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>🎓</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#15803D', marginBottom: 2 }}>Training Hub - Always 100% Free</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>All courses, certificates, and live sessions are completely free. No credit card required.</div>
          </div>
          <a href={`${LEARN_URL}/training`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#15803D', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none', flexShrink: 0 }}>
            Browse Free Courses →
          </a>
        </div>
      </section>

      {/* Plan Cards + comparison: LIVE from entitlement_plans (single source of
          truth), rendered by the LivePlanCards client island. The old
          platform_pricing / platform_features / plan_feature_access tables are no
          longer read for the live plans. */}
      <section style={{ padding: '64px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Modeling Platform</div>
        </div>
        {livePlans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6B7280' }}>
            <p style={{ fontSize: 16 }}>Pricing plans coming soon. Check back shortly.</p>
          </div>
        ) : (
          <LivePlanCards plans={livePlans} features={liveFeatures} coverage={liveCoverage} trialDays={trialDays} />
        )}

        <CouponInput />
      </section>

      {/* FAQ */}
      {faqs.length > 0 && (
        <section style={{ background: '#0D2E5A', padding: '72px 40px 88px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 48 }}>{faqHeading}</h2>
            <PricingAccordion faqs={faqs} dark />
          </div>
        </section>
      )}

      {/* Bottom CTA */}
      <section style={{ background: 'linear-gradient(90deg, #0D2E5A, #1B4F8A)', padding: 'clamp(56px,7vw,88px) 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(24px,4vw,40px)', fontWeight: 900, color: '#fff', marginBottom: 12, lineHeight: 1.15, letterSpacing: '-0.01em' }}>Ready to get started?</h2>
          <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,0.8)', marginBottom: 32, lineHeight: 1.6 }}>Start your free {trialDays}-day trial. No credit card required.</p>
          <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(90deg, #F97316, #EA580C)', color: '#fff', fontWeight: 800, fontSize: 16, padding: '15px 44px', borderRadius: 12, textDecoration: 'none', boxShadow: '0 12px 28px -8px rgba(234,88,12,0.6)' }}>
            Start free trial →
          </Link>
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
