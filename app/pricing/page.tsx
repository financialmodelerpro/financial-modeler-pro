import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getCmsContent, cms, getModules } from '@/src/lib/shared/cms';
import { getServerClient } from '@/src/lib/shared/supabase';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { PricingAccordion } from '@/src/components/pricing/PricingAccordion';
import { CouponInput } from './CouponInput';

export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Pricing — Financial Modeler Pro',
  description: 'Simple, transparent pricing for financial modeling professionals. Start free, upgrade when ready.',
};

interface PlatformPlan {
  id: string; platform_slug: string; plan_name: string; plan_label: string;
  price_monthly: number | null; price_label: string | null; description: string | null;
  is_featured: boolean; badge_text: string | null; badge_color: string | null;
  cta_text: string; cta_url: string; features: string[]; display_order: number;
  is_active: boolean; trial_days: number; max_projects: number | null;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export default async function PricingPage() {
  const [content, dbModules] = await Promise.all([getCmsContent(), getModules()]);

  // Fetch platform pricing
  const sb = getServerClient();
  const { data: rawPlans } = await sb
    .from('platform_pricing')
    .select('*')
    .eq('is_active', true)
    .order('display_order');
  const allPlans = (rawPlans ?? []) as PlatformPlan[];

  // Group by platform_slug
  const plansByPlatform = new Map<string, PlatformPlan[]>();
  for (const p of allPlans) {
    if (!plansByPlatform.has(p.platform_slug)) plansByPlatform.set(p.platform_slug, []);
    plansByPlatform.get(p.platform_slug)!.push(p);
  }

  // Only show platforms that are live
  const livePlatforms = dbModules.filter(m => m.status === 'live' && plansByPlatform.has(m.slug));

  // CMS text
  const heroTitle    = cms(content, 'pricing_page', 'hero_title',    'Simple, Transparent Pricing');
  const heroSubtitle = cms(content, 'pricing_page', 'hero_subtitle', 'Professional financial modeling tools. Start free, upgrade when ready.');

  let faqs: { question: string; answer: string }[] = [];
  try {
    const faqRaw = cms(content, 'pricing_page', 'faq', '');
    if (faqRaw) faqs = JSON.parse(faqRaw) as typeof faqs;
  } catch { /* ignore */ }

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Financial Modeler Pro Team');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{ background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)', padding: '72px 40px 64px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Pricing</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, color: '#fff', marginBottom: 14, lineHeight: 1.1 }}>{heroTitle}</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65 }}>{heroSubtitle}</p>
        </div>
      </section>

      {/* ── Training Hub Banner ───────────────────────────────────────────── */}
      <section style={{ background: '#F0FDF4', padding: '24px 40px', borderBottom: '1px solid #BBF7D0' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>🎓</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#15803D', marginBottom: 2 }}>Training Hub — Always 100% Free</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>All courses, certificates, and live sessions are completely free. No credit card required.</div>
          </div>
          <a href={`${LEARN_URL}/training`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#15803D', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none', flexShrink: 0 }}>
            Browse Free Courses →
          </a>
        </div>
      </section>

      {/* ── Platform Pricing ──────────────────────────────────────────────── */}
      <section style={{ padding: '64px 40px', maxWidth: 1200, margin: '0 auto' }}>
        {livePlatforms.length === 0 && allPlans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6B7280' }}>
            <p style={{ fontSize: 16 }}>Pricing plans coming soon. Check back shortly.</p>
          </div>
        ) : (
          <>
            {/* Platform tabs (if multiple) */}
            {livePlatforms.length > 1 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 40, flexWrap: 'wrap' }}>
                {livePlatforms.map(p => (
                  <a key={p.slug} href={`#${p.slug}`} style={{ padding: '8px 20px', borderRadius: 8, border: '2px solid #1B4F8A', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                    {p.name}
                  </a>
                ))}
              </div>
            )}

            {/* Render plans for each live platform */}
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
                      const features = Array.isArray(plan.features) ? plan.features : [];
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
                            <div style={{
                              position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                              background: plan.badge_color ?? '#1ABC9C', color: '#fff', fontSize: 10, fontWeight: 700,
                              padding: '4px 16px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                            }}>
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
                          {plan.max_projects != null && (
                            <div style={{ fontSize: 12, color: featured ? 'rgba(255,255,255,0.5)' : '#9CA3AF', marginBottom: 16 }}>
                              {plan.max_projects === 0 ? '' : `${plan.max_projects} project${plan.max_projects === 1 ? '' : 's'}`}
                              {plan.trial_days > 0 ? ` · ${plan.trial_days}-day trial` : ''}
                            </div>
                          )}
                          {features.length > 0 && (
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {features.map((f, i) => (
                                <li key={i} style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,0.85)' : '#374151', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                  <span style={{ color: featured ? '#86EFAC' : '#2EAA4A', fontWeight: 700, fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                                  {f}
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
                            opacity: plan.cta_url === '#' ? 0.5 : 1,
                            pointerEvents: plan.cta_url === '#' ? 'none' : 'auto',
                          }}>
                            {plan.cta_text}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Coupon Code */}
        <CouponInput />
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      {faqs.length > 0 && (
        <section style={{ background: '#0D2E5A', padding: '72px 40px 88px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 48 }}>Frequently Asked Questions</h2>
            <PricingAccordion faqs={faqs} dark />
          </div>
        </section>
      )}

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section style={{ background: '#1B4F8A', padding: 'clamp(48px,7vw,80px) 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
            Ready to get started?
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>
            Start with our free trial. No credit card required.
          </p>
          <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1B4F8A', fontWeight: 800, fontSize: 16, padding: '14px 40px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            Start Free Trial →
          </Link>
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
