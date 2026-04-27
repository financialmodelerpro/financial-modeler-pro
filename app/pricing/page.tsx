import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getCmsContent, cms, getModules, getAllPageSections } from '@/src/lib/shared/cms';
import { getServerClient } from '@/src/lib/shared/supabase';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { PricingAccordion } from '@/src/components/pricing/PricingAccordion';
import { CouponInput } from './CouponInput';

export const revalidate = 0;

const MAIN_URL_PR = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Pricing | Financial Modeler Pro',
  description: 'Flexible pricing for Financial Modeler Pro Training Hub and Modeling Hub platforms. Professional financial modeling training and institutional-grade modeling tools. Start free, upgrade when ready.',
  alternates: { canonical: `${MAIN_URL_PR}/pricing` },
};

interface PlatformPlan {
  id: string; platform_slug: string; plan_name: string; plan_label: string;
  price_monthly: number | null; price_label: string | null; description: string | null;
  is_featured: boolean; is_custom: boolean; badge_text: string | null; badge_color: string | null;
  cta_text: string; cta_url: string; features: string[]; display_order: number;
  is_active: boolean; trial_days: number; max_projects: number | null;
}

interface PlatformFeature {
  id: string; platform_slug: string; feature_key: string; feature_text: string; feature_category: string; display_order: number;
}

interface FeatureAccess {
  plan_id: string; feature_id: string; is_included: boolean; override_text: string | null;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

const CATEGORY_LABELS: Record<string, string> = {
  projects: 'Projects', modules: 'Modules', exports: 'Exports', support: 'Support', team: 'Team & Enterprise', general: 'General',
};

export default async function PricingPage() {
  const [content, dbModules, pricingSections] = await Promise.all([
    getCmsContent(),
    getModules(),
    getAllPageSections('pricing'),
  ]);
  const sb = getServerClient();

  // Fetch platform pricing
  const { data: rawPlans } = await sb.from('platform_pricing').select('*').eq('is_active', true).order('display_order');
  const allPlans = (rawPlans ?? []) as PlatformPlan[];

  // Group by platform
  const plansByPlatform = new Map<string, PlatformPlan[]>();
  for (const p of allPlans) {
    if (!plansByPlatform.has(p.platform_slug)) plansByPlatform.set(p.platform_slug, []);
    plansByPlatform.get(p.platform_slug)!.push(p);
  }

  // Fetch platform features + access
  const platformSlugs = [...plansByPlatform.keys()];
  const { data: rawFeatures } = await sb
    .from('platform_features')
    .select('*')
    .in('platform_slug', platformSlugs.length > 0 ? platformSlugs : ['_none_'])
    .eq('is_active', true)
    .order('display_order');
  const features = (rawFeatures ?? []) as PlatformFeature[];

  const planIds = allPlans.map(p => p.id);
  const { data: rawAccess } = await sb
    .from('plan_feature_access')
    .select('*')
    .in('plan_id', planIds.length > 0 ? planIds : ['_none_']);
  const accessRows = (rawAccess ?? []) as FeatureAccess[];

  // Build access map: planId -> featureId -> {included, override}
  const accessMap = new Map<string, Map<string, { included: boolean; override: string | null }>>();
  for (const a of accessRows) {
    if (!accessMap.has(a.plan_id)) accessMap.set(a.plan_id, new Map());
    accessMap.get(a.plan_id)!.set(a.feature_id, { included: a.is_included, override: a.override_text });
  }

  // Live platforms
  const livePlatforms = dbModules.filter(m => m.status === 'live' && plansByPlatform.has(m.slug));

  // CMS — hero + FAQ sourced from page_sections (Page Builder is canonical).
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

  // Build included features per plan (for card checklists)
  function getPlanFeatures(planId: string, platformSlug: string): { text: string; included: boolean }[] {
    const am = accessMap.get(planId);
    if (!am) return [];
    return features
      .filter(f => f.platform_slug === platformSlug)
      .map(f => {
        const a = am.get(f.id);
        return { text: a?.override || f.feature_text, included: a?.included ?? false };
      })
      .filter(f => f.included);
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)', padding: '72px 40px 64px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>{heroBadge}</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', marginBottom: 14, lineHeight: 1.1 }}>{heroTitle}</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65 }}>{heroSubtitle}</p>
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

      {/* Plan Cards */}
      <section style={{ padding: '64px 40px', maxWidth: 1200, margin: '0 auto' }}>
        {allPlans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6B7280' }}>
            <p style={{ fontSize: 16 }}>Pricing plans coming soon. Check back shortly.</p>
          </div>
        ) : (
          <>
            {(livePlatforms.length > 0 ? livePlatforms : [{ slug: allPlans[0]?.platform_slug ?? '', name: 'Modeling Platform', icon: '📐' }]).map(platform => {
              const plans = plansByPlatform.get(platform.slug) ?? [];
              if (plans.length === 0) return null;
              return (
                <div key={platform.slug} id={platform.slug} style={{ marginBottom: 64 }}>
                  <div style={{ textAlign: 'center', marginBottom: 40 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                      {platform.name}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
                    {plans.map(plan => {
                      const featured = plan.is_featured;
                      const priceText = plan.price_label ?? (plan.price_monthly != null ? `$${plan.price_monthly} / month` : 'Contact Us');
                      const includedFeatures = getPlanFeatures(plan.id, platform.slug);
                      // Fallback to inline features if no access rows
                      const displayFeatures = includedFeatures.length > 0
                        ? includedFeatures
                        : (Array.isArray(plan.features) ? plan.features : []).map(f => ({ text: f, included: true }));

                      return (
                        <div key={plan.id} style={{
                          background: featured ? '#1B4F8A' : '#fff',
                          border: `2px solid ${featured ? 'transparent' : '#E5E7EB'}`,
                          borderRadius: 16, padding: '36px 28px',
                          position: 'relative',
                          boxShadow: featured ? '0 12px 48px rgba(27,79,138,0.3)' : '0 2px 12px rgba(0,0,0,0.05)',
                          display: 'flex', flexDirection: 'column',
                        }}>
                          {plan.badge_text && (
                            <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: plan.badge_color ?? '#1ABC9C', color: '#fff', fontSize: 10, fontWeight: 700, padding: '4px 16px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                              {plan.badge_text}
                            </div>
                          )}
                          <div style={{ fontSize: 12, fontWeight: 700, color: featured ? 'rgba(255,255,255,0.6)' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                            {plan.plan_label}
                          </div>
                          <div style={{ fontSize: 26, fontWeight: 800, color: featured ? '#fff' : '#1B3A6B', marginBottom: 6 }}>
                            {priceText}
                          </div>
                          {plan.description && (
                            <p style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.55)' : '#6B7280', marginBottom: 20, lineHeight: 1.5 }}>
                              {plan.description}
                            </p>
                          )}
                          {displayFeatures.length > 0 && (
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {displayFeatures.map((f, i) => (
                                <li key={i} style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.85)' : '#374151', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                  <span style={{ color: featured ? '#86EFAC' : '#2EAA4A', fontWeight: 700, fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                                  {f.text}
                                </li>
                              ))}
                            </ul>
                          )}
                          <Link href={plan.cta_url} style={{
                            display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto',
                            padding: '12px 0', borderRadius: 8, fontWeight: 700, fontSize: 14,
                            background: featured ? 'rgba(255,255,255,0.18)' : '#1B4F8A', color: '#fff',
                            border: featured ? '1px solid rgba(255,255,255,0.3)' : 'none',
                            opacity: plan.cta_url === '#' ? 0.5 : 1,
                            pointerEvents: plan.cta_url === '#' ? 'none' : 'auto',
                          }}>
                            {plan.cta_text}
                          </Link>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comparison Table */}
                  {features.filter(f => f.platform_slug === platform.slug).length > 0 && (
                    <div style={{ marginTop: 64 }}>
                      <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', textAlign: 'center', marginBottom: 40 }}>Feature Comparison</h2>
                      {/* I1: the table has minWidth:600 and overflowX:auto,
                          so narrow screens already scroll horizontally — but
                          there's no visual hint that scrolling is possible.
                          The inset right-edge gradient shadow makes the
                          scrollable area discoverable. */}
                      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden', overflowX: 'auto', boxShadow: 'inset -24px 0 18px -24px rgba(13,46,90,0.25)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                          <thead>
                            <tr style={{ background: '#1B4F8A' }}>
                              <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                              {plans.map(p => (
                                <th key={p.id} style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{p.plan_label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const pf = features.filter(f => f.platform_slug === platform.slug);
                              const cats = [...new Set(pf.map(f => f.feature_category))];
                              return cats.map(cat => (
                                <>
                                  <tr key={`cat-${cat}`}>
                                    <td colSpan={plans.length + 1} style={{ padding: '10px 20px 6px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                                      {CATEGORY_LABELS[cat] || cat}
                                    </td>
                                  </tr>
                                  {pf.filter(f => f.feature_category === cat).map((feat, fi) => (
                                    <tr key={feat.id} style={{ borderBottom: '1px solid #F3F4F6', background: fi % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                                      <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151' }}>{feat.feature_text}</td>
                                      {plans.map(plan => {
                                        const a = accessMap.get(plan.id)?.get(feat.id);
                                        const included = a?.included ?? false;
                                        const override = a?.override ?? null;
                                        return (
                                          <td key={plan.id} style={{ padding: '12px 16px', textAlign: 'center' }}>
                                            {override ? (
                                              <span style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A' }}>{override}</span>
                                            ) : included ? (
                                              <span style={{ fontSize: 16, color: '#2EAA4A' }}>✓</span>
                                            ) : (
                                              <span style={{ fontSize: 16, color: '#D1D5DB' }}>✗</span>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
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
      <section style={{ background: '#1B4F8A', padding: 'clamp(48px,7vw,80px) 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>Ready to get started?</h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>Start with our free trial. No credit card required.</p>
          <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1B4F8A', fontWeight: 800, fontSize: 16, padding: '14px 40px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            Start Free Trial →
          </Link>
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
