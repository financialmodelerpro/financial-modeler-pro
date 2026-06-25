/**
 * PricingPageBody.tsx (server)
 *
 * The ONE pricing page body, rendered by BOTH the public marketing pricing route
 * (app/pricing/page.tsx, served on the apex) AND the in-app pricing route
 * (app/modeling/pricing/page.tsx, served at app.* /pricing). One design, one data
 * source (entitlement tables), used in both contexts.
 *
 * Data (plans / features / coverage) loads server-side with the service-role
 * client via loadPricingCatalog, so it works for a logged-OUT visitor too. The
 * interactive island (PricingExplorer) is session-aware: logged-out keeps the
 * /register handoff; logged-in runs in-app checkout / trial + resume. So this
 * single body is correct on the apex (marketing) and on the app subdomain
 * (in-app) without branching here.
 *
 * No em dashes in this file.
 */
import Link from 'next/link';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getCmsContent, cms, getAllPageSections, getModules } from '@/src/shared/cms';
import { getServerClient } from '@/src/core/db/supabase';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { PricingAccordion } from '@/src/hubs/main/components/pricing/PricingAccordion';
import PricingExplorer, { type PickerPlatform, type PlatformPricing } from '@/src/hubs/main/components/pricing/PricingExplorer';
import { loadPricingCatalog, visibleForCustomers } from '@/src/shared/entitlements/pricingCatalog';
import { PLATFORMS } from '@/src/hubs/modeling/config/platforms';

export default async function PricingPageBody() {
  const [content, pricingSections] = await Promise.all([
    getCmsContent(),
    getAllPageSections('pricing'),
  ]);
  const sb = getServerClient();

  // VISIBILITY + ORDER are owned by the admin dashboard, NOT the static config.
  // getModules() reads the `modules` table (which stores platforms) the exact
  // same way the modeling-hub overview + sidebar do: it returns only platforms
  // whose status is not 'hidden', in display_order. The static config is used
  // ONLY as a presentational lookup (tagline / shortName) keyed by slug, never
  // to decide which platforms appear or their order. So hiding / reordering /
  // toggling a platform in the dashboard reflects here automatically.
  const dashboardPlatforms = await getModules();
  const presentation = new Map(PLATFORMS.map((p) => [p.slug, p]));
  const pickerPlatforms: PickerPlatform[] = dashboardPlatforms.map((p) => {
    const meta = presentation.get(p.slug);
    return {
      slug: p.slug,
      name: p.name,
      shortName: meta?.shortName ?? p.name,
      icon: p.icon || meta?.icon || '',
      // getModules() already excludes 'hidden'; only live / coming_soon remain.
      status: p.status === 'live' ? 'live' : 'coming_soon',
      tagline: meta?.tagline ?? p.description ?? '',
    };
  });

  // For each LIVE platform (per the dashboard), load its plans/comparison from
  // the entitlement tables (the single source of truth), so selecting it reveals
  // real plans in place. loadPricingCatalog runs server-side with the
  // service-role client, so it works for an unauthenticated visitor. Hidden
  // non-module features are filtered out. Coming-soon platforms are never loaded
  // (not clickable).
  const livePlatforms = dashboardPlatforms.filter((p) => p.status === 'live');
  const loaded = await Promise.all(
    livePlatforms.map(async (p) => [p.slug, await loadPricingCatalog(sb, p.slug)] as const),
  );
  const pricingByPlatform: Record<string, PlatformPricing> = {};
  for (const [slug, cat] of loaded) {
    pricingByPlatform[slug] = {
      plans: cat.plans,
      features: visibleForCustomers(cat.features),
      coverage: cat.coverage,
      trialDays: cat.trialDays,
      credibilityLine: cat.credibilityLine,
    };
  }
  // The single-source trial length for the bottom CTA copy (the live REFM
  // platform; falls back to the first live platform if REFM is ever hidden).
  const trialDays = pricingByPlatform['real-estate']?.trialDays ?? Object.values(pricingByPlatform)[0]?.trialDays ?? 0;

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

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a platform by PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Financial Modeler Pro Team');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero (FMP navy + brand gold; text from Page Builder) */}
      <section style={{ position: 'relative', background: 'radial-gradient(1200px 400px at 50% -10%, #163a6b 0%, #0D2E5A 45%, #0A2448 100%)', padding: 'clamp(64px, 9vw, 96px) 40px clamp(56px, 7vw, 72px)', textAlign: 'center', color: '#fff', overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 220, height: 4, background: '#C9A84C' }} />
        <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, color: '#F4E6BC', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 18, padding: '6px 14px', borderRadius: 999, background: 'rgba(201,168,76,0.16)', border: '1px solid rgba(201,168,76,0.40)' }}>{heroBadge}</div>
          <h1 style={{ fontSize: 'clamp(30px, 4.6vw, 52px)', fontWeight: 900, color: '#fff', marginBottom: 16, lineHeight: 1.08, letterSpacing: '-0.02em' }}>{heroTitle}</h1>
          <p style={{ fontSize: 'clamp(15px, 1.7vw, 18px)', color: 'rgba(255,255,255,0.72)', lineHeight: 1.65, maxWidth: 560, margin: '0 auto' }}>{heroSubtitle}</p>
        </div>
      </section>

      {/* Platform picker (step 1) -> plans for the selected platform in place
          (step 2). Both steps are one page, no navigation. The picker is driven
          by the platform config, so new platforms appear automatically. No
          course or free-training content lives in this flow. */}
      <section style={{ padding: '64px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <PricingExplorer platforms={pickerPlatforms} pricingByPlatform={pricingByPlatform} />
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
          <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#C9A84C', color: '#0D2E5A', fontWeight: 800, fontSize: 16, padding: '15px 44px', borderRadius: 12, textDecoration: 'none', boxShadow: '0 12px 28px -8px rgba(201,168,76,0.55)' }}>
            Start free trial &rarr;
          </Link>
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
