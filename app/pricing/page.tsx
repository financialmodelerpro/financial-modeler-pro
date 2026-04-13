/**
 * /pricing — Public pricing page
 * Server component with ISR. All data comes from Supabase + CMS.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getCmsContent, cms, getPageSections } from '@/src/lib/shared/cms';
import { getServerClient } from '@/src/lib/shared/supabase';
import { PricingAccordion } from '@/src/components/pricing/PricingAccordion';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { SectionRenderer } from '@/src/components/cms/SectionRenderer';

export const revalidate = 3600; // revalidate every hour

export const metadata: Metadata = {
  title: 'Pricing — Financial Modeler Pro',
  description: 'Simple, transparent pricing for financial modeling professionals.',
};

interface Plan {
  id: string; name: string; code: string; tagline: string | null;
  price_monthly: number | null; price_yearly: number | null; price_display: string | null;
  currency: string; is_featured: boolean; badge_text: string | null; badge_color: string;
  cta_text: string; cta_url: string; highlight_color: string | null; display_order: number;
}

interface Feature {
  id: string; plan_id: string; category: string; feature_text: string;
  tooltip: string | null; is_included: boolean; display_order: number;
}

const BADGE_COLORS: Record<string, string> = {
  green: '#2EAA4A', gold: '#C9A84C', navy: '#1B4F8A', grey: '#6B7280', red: '#DC2626',
};

async function getPricingData() {
  try {
    const sb = getServerClient();
    const { data: plans } = await sb
      .from('pricing_plans')
      .select('id,name,code,tagline,price_monthly,price_yearly,price_display,currency,is_featured,badge_text,badge_color,cta_text,cta_url,highlight_color,display_order')
      .eq('is_public', true).eq('is_active', true).eq('is_custom_client', false)
      .order('display_order');
    if (!plans?.length) return { plans: [], featuresMap: {} };

    const planIds = plans.map((p: Plan) => p.id);
    const { data: features } = await sb
      .from('pricing_features')
      .select('*')
      .in('plan_id', planIds)
      .order('category').order('display_order');

    const featuresMap: Record<string, Feature[]> = {};
    for (const f of (features ?? []) as Feature[]) {
      if (!featuresMap[f.plan_id]) featuresMap[f.plan_id] = [];
      featuresMap[f.plan_id].push(f);
    }
    return { plans: plans as Plan[], featuresMap };
  } catch {
    return { plans: [], featuresMap: {} };
  }
}

export default async function PricingPage() {
  const [content, { plans, featuresMap }, sections] = await Promise.all([
    getCmsContent(),
    getPricingData(),
    getPageSections('pricing'),
  ]);

  const badge           = cms(content, 'pricing_page', 'badge',            'Pricing');
  const heroTitle       = cms(content, 'pricing_page', 'hero_title',       'Simple, Transparent Pricing');
  const heroSubtitle    = cms(content, 'pricing_page', 'hero_subtitle',    'Choose the plan that fits your needs');
  const footerNote      = cms(content, 'pricing_page', 'footer_note',      'All plans include free training access. No credit card required for Free plan.');
  const comparisonTitle = cms(content, 'pricing_page', 'comparison_title', 'Feature Comparison');
  const faqTitle        = cms(content, 'pricing_page', 'faq_title',        'Frequently Asked Questions');

  let faqs: { question: string; answer: string }[] = [];
  try {
    const faqRaw = cms(content, 'pricing_page', 'faq', '');
    if (faqRaw) faqs = JSON.parse(faqRaw) as typeof faqs;
  } catch { /* ignore */ }

  // Build comparison matrix
  const allFeatures: { category: string; feature_text: string }[] = [];
  const seen = new Set<string>();
  for (const planFeatures of Object.values(featuresMap)) {
    for (const f of planFeatures) {
      const key = `${f.category}||${f.feature_text}`;
      if (!seen.has(key)) { seen.add(key); allFeatures.push({ category: f.category, feature_text: f.feature_text }); }
    }
  }
  // Group by category
  const categories = Array.from(new Set(allFeatures.map(f => f.category)));
  const featuresByCategory: Record<string, string[]> = {};
  for (const cat of categories) {
    featuresByCategory[cat] = allFeatures.filter(f => f.category === cat).map(f => f.feature_text);
  }

  const showComparisonTable = plans.length > 0 && allFeatures.length > 0;

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  // Shared pricing cards + comparison table + FAQ JSX
  const pricingBody = (
    <>
      {/* Plan Cards */}
      <section style={{ padding: '64px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {plans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6B7280' }}>
            <p style={{ fontSize: 16 }}>Pricing plans coming soon. Check back shortly.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`, gap: 24 }}>
            {plans.map(plan => {
              const border    = plan.highlight_color ?? '#E5E7EB';
              const featured  = plan.is_featured;
              const priceText = plan.price_display ?? (plan.price_monthly != null ? `$${plan.price_monthly} / month` : 'Contact Us');
              const features  = featuresMap[plan.id] ?? [];
              const badgeColor = BADGE_COLORS[plan.badge_color] ?? '#2EAA4A';

              return (
                <div key={plan.id} style={{
                  background: featured ? '#1B4F8A' : '#fff',
                  border: `2px solid ${featured ? 'transparent' : border}`,
                  borderRadius: 16, padding: '36px 28px',
                  position: 'relative',
                  boxShadow: featured ? '0 12px 48px rgba(27,79,138,0.3)' : '0 2px 12px rgba(0,0,0,0.05)',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {plan.badge_text && (
                    <div style={{
                      position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                      background: badgeColor, color: '#fff', fontSize: 10, fontWeight: 700,
                      padding: '4px 16px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                    }}>
                      {plan.badge_text}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, color: featured ? 'rgba(255,255,255,0.6)' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    {plan.name}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: featured ? '#fff' : '#1B3A6B', marginBottom: 6 }}>
                    {priceText}
                  </div>
                  {plan.tagline && (
                    <p style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.55)' : '#6B7280', marginBottom: 24, lineHeight: 1.5 }}>
                      {plan.tagline}
                    </p>
                  )}
                  {features.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {features.filter(f => f.is_included).map(f => (
                        <li key={f.id} style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.85)' : '#374151', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ color: featured ? '#86EFAC' : '#2EAA4A', fontWeight: 700, fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                          {f.feature_text}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href={plan.cta_url} style={{
                    display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto',
                    padding: '12px 0', borderRadius: 8, fontWeight: 700, fontSize: 14,
                    background: featured ? 'rgba(255,255,255,0.18)' : '#1B4F8A',
                    color: '#fff',
                    border: featured ? '1px solid rgba(255,255,255,0.3)' : 'none',
                  }}>
                    {plan.cta_text}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        {footerNote && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#9CA3AF', marginTop: 32 }}>{footerNote}</p>
        )}
      </section>

      {/* Feature Comparison Table */}
      {showComparisonTable && (
        <section style={{ padding: '0 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', textAlign: 'center', marginBottom: 40 }}>{comparisonTitle}</h2>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                  {plans.map(p => (
                    <th key={p.id} style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <>
                    <tr key={`cat-${cat}`}>
                      <td colSpan={plans.length + 1} style={{ padding: '10px 20px 6px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                        {cat}
                      </td>
                    </tr>
                    {featuresByCategory[cat].map((feat, fi) => (
                      <tr key={`${cat}-${fi}`} style={{ borderBottom: '1px solid #F3F4F6', background: fi % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151' }}>{feat}</td>
                        {plans.map(plan => {
                          const planFeatures = featuresMap[plan.id] ?? [];
                          const match = planFeatures.find(f => f.category === cat && f.feature_text === feat);
                          const included = match?.is_included ?? false;
                          return (
                            <td key={plan.id} style={{ padding: '12px 16px', textAlign: 'center' }}>
                              {included
                                ? <span style={{ fontSize: 16, color: '#2EAA4A' }}>✓</span>
                                : <span style={{ fontSize: 16, color: '#D1D5DB' }}>✗</span>
                              }
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );

  const pricingFaq = faqs.length > 0 ? (
    <section style={{ padding: '0 40px 88px', background: '#0D2E5A' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', paddingTop: 72 }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 48 }}>{faqTitle}</h2>
        <PricingAccordion faqs={faqs} dark />
      </div>
    </section>
  ) : null;

  // CMS-driven rendering
  if (sections.length > 0) {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
        <NavbarServer />
        <div style={{ height: 64 }} />

        {sections.map((section) => {
          const dynamic = (section.content as Record<string, unknown>)?._dynamic;
          if (dynamic === 'pricing_plans') {
            return <div key={section.id}>{pricingBody}</div>;
          }
          if (dynamic === 'pricing_faq') {
            return <div key={section.id}>{pricingFaq}</div>;
          }
          return <SectionRenderer key={section.id} sections={[section]} />;
        })}

        <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
      </div>
    );
  }

  // Fallback: original hardcoded layout
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* ── Hero ── */}
      <section style={{ background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)', padding: '72px 40px 64px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>{badge}</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', marginBottom: 14, lineHeight: 1.1 }}>{heroTitle}</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65 }}>{heroSubtitle}</p>
        </div>
      </section>

      {/* ── Plan Cards ── */}
      <section style={{ padding: '64px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {plans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6B7280' }}>
            <p style={{ fontSize: 16 }}>Pricing plans coming soon. Check back shortly.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`, gap: 24 }}>
            {plans.map(plan => {
              const border    = plan.highlight_color ?? '#E5E7EB';
              const featured  = plan.is_featured;
              const priceText = plan.price_display ?? (plan.price_monthly != null ? `$${plan.price_monthly} / month` : 'Contact Us');
              const features  = featuresMap[plan.id] ?? [];
              const badgeColor = BADGE_COLORS[plan.badge_color] ?? '#2EAA4A';

              return (
                <div key={plan.id} style={{
                  background: featured ? '#1B4F8A' : '#fff',
                  border: `2px solid ${featured ? 'transparent' : border}`,
                  borderRadius: 16, padding: '36px 28px',
                  position: 'relative',
                  boxShadow: featured ? '0 12px 48px rgba(27,79,138,0.3)' : '0 2px 12px rgba(0,0,0,0.05)',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {/* Badge */}
                  {plan.badge_text && (
                    <div style={{
                      position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                      background: badgeColor, color: '#fff', fontSize: 10, fontWeight: 700,
                      padding: '4px 16px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                    }}>
                      {plan.badge_text}
                    </div>
                  )}

                  {/* Plan name */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: featured ? 'rgba(255,255,255,0.6)' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    {plan.name}
                  </div>

                  {/* Price */}
                  <div style={{ fontSize: 26, fontWeight: 800, color: featured ? '#fff' : '#1B3A6B', marginBottom: 6 }}>
                    {priceText}
                  </div>

                  {/* Tagline */}
                  {plan.tagline && (
                    <p style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.55)' : '#6B7280', marginBottom: 24, lineHeight: 1.5 }}>
                      {plan.tagline}
                    </p>
                  )}

                  {/* Features */}
                  {features.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {features.filter(f => f.is_included).map(f => (
                        <li key={f.id} style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.85)' : '#374151', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ color: featured ? '#86EFAC' : '#2EAA4A', fontWeight: 700, fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                          {f.feature_text}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* CTA */}
                  <Link href={plan.cta_url} style={{
                    display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto',
                    padding: '12px 0', borderRadius: 8, fontWeight: 700, fontSize: 14,
                    background: featured ? 'rgba(255,255,255,0.18)' : '#1B4F8A',
                    color: '#fff',
                    border: featured ? '1px solid rgba(255,255,255,0.3)' : 'none',
                  }}>
                    {plan.cta_text}
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {footerNote && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#9CA3AF', marginTop: 32 }}>{footerNote}</p>
        )}
      </section>

      {/* ── Feature Comparison Table ── */}
      {showComparisonTable && (
        <section style={{ padding: '0 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', textAlign: 'center', marginBottom: 40 }}>{comparisonTitle}</h2>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                  {plans.map(p => (
                    <th key={p.id} style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <>
                    <tr key={`cat-${cat}`}>
                      <td colSpan={plans.length + 1} style={{ padding: '10px 20px 6px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                        {cat}
                      </td>
                    </tr>
                    {featuresByCategory[cat].map((feat, fi) => (
                      <tr key={`${cat}-${fi}`} style={{ borderBottom: '1px solid #F3F4F6', background: fi % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151' }}>{feat}</td>
                        {plans.map(plan => {
                          const planFeatures = featuresMap[plan.id] ?? [];
                          const match = planFeatures.find(f => f.category === cat && f.feature_text === feat);
                          const included = match?.is_included ?? false;
                          return (
                            <td key={plan.id} style={{ padding: '12px 16px', textAlign: 'center' }}>
                              {included
                                ? <span style={{ fontSize: 16, color: '#2EAA4A' }}>✓</span>
                                : <span style={{ fontSize: 16, color: '#D1D5DB' }}>✗</span>
                              }
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      {faqs.length > 0 && (
        <section style={{ padding: '0 40px 88px', background: '#0D2E5A' }}>
          <div style={{ maxWidth: 800, margin: '0 auto', paddingTop: 72 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 48 }}>{faqTitle}</h2>
            <PricingAccordion faqs={faqs} dark />
          </div>
        </section>
      )}

      {/* ── Footer note ── */}
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
