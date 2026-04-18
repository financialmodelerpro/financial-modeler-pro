// v-cms-platform-072
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { PLATFORMS, getPlatform } from '@/src/config/platforms';
import type { PlatformModule } from '@/src/config/platforms';
import { getModules, getAllPageSections } from '@/src/lib/shared/cms';
import { CmsField, cmsVisible } from '@/src/components/cms/CmsField';

// Per-field width + alignment style from admin VF keys.
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

export const revalidate = 0;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

// ── Static params ──────────────────────────────────────────────────────────

export function generateStaticParams() {
  return PLATFORMS.map((p) => ({ slug: p.slug }));
}

// ── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) {
    return { title: 'Platform Not Found | Financial Modeler Pro' };
  }
  return {
    title: `${platform.name} | Modeling Hub - Financial Modeler Pro`,
    description: platform.description,
  };
}

// ── Module status helpers ──────────────────────────────────────────────────

function moduleCircleColor(status: PlatformModule['status']): string {
  if (status === 'complete') return '#15803D';
  if (status === 'in_progress') return '#1B4F8A';
  return '#9CA3AF';
}

function moduleBadgeStyle(status: PlatformModule['status']): React.CSSProperties {
  if (status === 'complete') {
    return { background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0' };
  }
  if (status === 'in_progress') {
    return { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' };
  }
  return { background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' };
}

function moduleStatusLabel(status: PlatformModule['status']): string {
  if (status === 'complete') return '✅ Available Now';
  if (status === 'in_progress') return '🔵 In Development';
  return '📋 Coming Soon';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PlatformDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();

  // Respect admin visibility - hidden platforms return 404
  const dbModules = await getModules();
  const dbEntry = dbModules.find((m) => m.slug === slug);
  if (!dbEntry) notFound();

  // DB overrides name/description/icon/status; static config provides colors + detail content
  const displayName = dbEntry.name || platform.name;
  const displayDesc = dbEntry.description || platform.description;
  const isLive = (dbEntry.status as string) === 'live';

  // ── CMS sections for this platform ─────────────────────────────────────
  const cmsSections = await getAllPageSections(`modeling-${slug}`);

  const findSection = (type: string, dynamic?: string) =>
    cmsSections.find(s => {
      if (s.section_type !== type) return false;
      if (dynamic) return (s.content as Record<string, unknown>)?._dynamic === dynamic;
      return !(s.content as Record<string, unknown>)?._dynamic;
    });

  const findSectionByOrder = (order: number) =>
    cmsSections.find(s => s.display_order === order);

  const fc = (raw: ReturnType<typeof findSection>) =>
    raw?.visible !== false ? raw?.content as Record<string, unknown> | undefined : undefined;
  const hidden = (raw: ReturnType<typeof findSection>) => raw?.visible === false;

  // ── LIVE platform layout ──────────────────────────────────────────────
  if (isLive) {
    const heroRaw    = findSection('hero');
    const statsRaw   = findSection('stats');
    const textImgRaw = findSection('text_image') || findSection('text');
    // Find list sections by heading content to avoid order dependency
    const listSections = cmsSections.filter(s => s.section_type === 'list');
    const whoRaw     = listSections.find(s => ((s.content as Record<string, unknown>)?.heading as string)?.includes('Who')) || listSections[0];
    const whatRaw    = listSections.find(s => ((s.content as Record<string, unknown>)?.heading as string)?.includes('Get') || ((s.content as Record<string, unknown>)?.heading as string)?.includes('What You')) || listSections[1];
    const moduleRaw  = findSection('embed', 'platform_modules');
    const ctaRaw     = findSection('cta');

    const h = fc(heroRaw);
    const heroHeadline  = (h?.headline as string)           || displayName;
    const heroSubtitle  = (h?.subtitle as string)           || platform.tagline;
    const heroBadge     = (h?.badge as string)              || platform.shortName;
    const heroStatusBdg = (h?.status_badge as string)       || '✓ LIVE - Available Now';
    const heroCta1Text  = (h?.cta_primary_text as string)   || 'Launch Platform →';
    const heroCta1Url   = (h?.cta_primary_url as string)    || '/signin';
    const heroCta2Text  = (h?.cta_secondary_text as string) || '← Back to Modeling Hub';
    const heroCta2Url   = (h?.cta_secondary_url as string)  || '/modeling';

    // Stats bar
    const statsContent = fc(statsRaw);
    const statsItems = (statsContent?.items as { value: string; label: string; visible?: boolean }[]) ?? [];
    const statsBg = (statsRaw?.styles as Record<string, string>)?.bgColor ?? '#0A2248';

    const tc = fc(textImgRaw);
    const whatCoversHead = (tc?.heading as string)  || 'What This Platform Covers';
    const whatCoversBody = (tc?.body as string) || (tc?.html as string) || platform.longDescription;
    const rawParas = Array.isArray(tc?.paragraphs) ? tc.paragraphs as (string | { text: string; align?: string })[] : [];
    const whatCoversParagraphs = rawParas.map(p => typeof p === 'string' ? { text: p, align: 'left' as string } : { text: p.text ?? '', align: p.align ?? 'left' }).filter(p => p.text);
    const whatCoversImg  = (tc?.imageSrc as string) || '';
    const whatCoversImgPos  = (tc?.imagePosition as string) || 'right';
    const whatCoversImgPlaceholder = (tc?.imagePlaceholder as string) || '';

    const wc = fc(whoRaw);
    const whoHead  = (wc?.heading as string) || 'Who Is It For';
    const whoItems = wc?.items
      ? (wc.items as { icon?: string; title: string; description?: string }[]).map(i => i.title)
      : platform.whoIsItFor;

    const gc = fc(whatRaw);
    const getHead  = (gc?.heading as string) || 'What You Get';
    const getItems = gc?.items
      ? (gc.items as { icon?: string; title: string; description?: string }[]).map(i => i.title)
      : platform.whatYouGet;

    const mc = fc(moduleRaw);
    const moduleGuideHead = (mc?.heading as string)    || 'Step-by-Step Module Guide';
    const moduleGuideSub  = (mc?.subheading as string) || 'Build your model module by module - each unlocks when you complete the previous step.';

    const cc = fc(ctaRaw);
    const ctaHead    = (cc?.heading as string)           || 'Ready to build your model?';
    const ctaDesc    = (cc?.description as string)       || 'Start with Module 1 - free, structured, and ready to use right now.';
    const ctaText    = (cc?.cta_text as string)          || 'Launch Platform Free →';
    const ctaUrl     = (cc?.cta_url as string)           || '/register';

    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
        <NavbarServer />
        <div style={{ height: 64 }} />

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        {!hidden(heroRaw) && (
          <section style={{
            background: `linear-gradient(135deg, ${platform.color}EE 0%, ${platform.color} 100%)`,
            padding: 'clamp(48px,7vw,88px) 40px clamp(56px,8vw,96px)',
            color: '#fff',
          }}>
            <div style={{ maxWidth: 'min(1200px, 90vw)', margin: '0 auto' }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link href="/modeling" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>Modeling Hub</Link>
                <span>→</span>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>{heroHeadline}</span>
              </div>

              {cmsVisible(h ?? {}, 'badge') && (
                <div style={{
                  ...fw(h, 'badge'),
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: platform.bgColor, borderRadius: 6,
                  padding: '4px 12px', fontSize: 11, fontWeight: 800,
                  color: platform.color, letterSpacing: '0.08em',
                  textTransform: 'uppercase', marginBottom: 20,
                }}>
                  {dbEntry.icon || platform.icon} {heroBadge}
                </div>
              )}

              {cmsVisible(h ?? {}, 'headline') && (
                <h1 style={{
                  fontSize: 'clamp(26px,4.5vw,48px)', fontWeight: 800,
                  color: '#fff', lineHeight: 1.15, marginBottom: 16,
                  letterSpacing: '-0.02em',
                  ...fw(h, 'headline'),
                }}>
                  {heroHeadline}
                </h1>
              )}

              <CmsField
                content={h ?? { subtitle: heroSubtitle }}
                field="subtitle"
                as="p"
                style={{
                  fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.75)',
                  lineHeight: 1.65, marginBottom: 28, maxWidth: 960, marginLeft: 'auto', marginRight: 'auto',
                }}
              />

              {cmsVisible(h ?? {}, 'status_badge') && heroStatusBdg && (
                <div style={{
                  ...fw(h, 'status_badge'),
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'rgba(255,255,255,0.15)', borderRadius: 6,
                  padding: '6px 14px', fontSize: 12, fontWeight: 700,
                  color: '#fff', marginBottom: 32,
                }}>
                  {heroStatusBdg}
                </div>
              )}

              {(cmsVisible(h ?? {}, 'cta_primary') || cmsVisible(h ?? {}, 'cta_secondary')) && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {cmsVisible(h ?? {}, 'cta_primary') && heroCta1Text && heroCta1Url && (
                    <a href={`${APP_URL}${heroCta1Url}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: '#fff', color: platform.color,
                      fontWeight: 700, fontSize: 15, padding: '13px 32px',
                      borderRadius: 8, textDecoration: 'none',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    }}>
                      {heroCta1Text}
                    </a>
                  )}
                  {cmsVisible(h ?? {}, 'cta_secondary') && heroCta2Text && heroCta2Url && (
                    <Link href={heroCta2Url} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: 'transparent', color: '#fff',
                      fontWeight: 700, fontSize: 15, padding: '13px 32px',
                      borderRadius: 8, textDecoration: 'none',
                      border: '2px solid rgba(255,255,255,0.4)',
                    }}>
                      {heroCta2Text}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Stats Bar ──────────────────────────────────────────────────── */}
        {!hidden(statsRaw) && statsItems.length > 0 && (
          <section style={{ background: statsBg, padding: '28px 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', justifyContent: 'center', gap: 48, flexWrap: 'wrap' }}>
              {statsItems.filter(s => s.visible !== false).map((stat, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{stat.value}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── What It Covers ──────────────────────────────────────────────── */}
        {!hidden(textImgRaw) && (
          <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              {cmsVisible(tc ?? {}, 'heading') && (
                <h2 style={{ ...fw(tc, 'heading'), fontSize: 'clamp(20px,3vw,30px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 20 }}>
                  {whatCoversHead}
                </h2>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: whatCoversImg ? 'repeat(auto-fit,minmax(300px,1fr))' : '1fr', gap: 40, alignItems: 'start' }}>
                <div style={{ order: whatCoversImgPos === 'left' ? 1 : 0 }}>
                  <CmsField
                    content={tc ?? { body: whatCoversBody }}
                    field="body"
                    as="div"
                    style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, maxWidth: whatCoversImg ? undefined : 760 }}
                  />
                  {whatCoversParagraphs.map((para, i) => (
                    <p key={i} style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginTop: 16, textAlign: para.align as React.CSSProperties['textAlign'] }}>
                      {para.text}
                    </p>
                  ))}
                </div>
                {whatCoversImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={whatCoversImg} alt={whatCoversHead} style={{ width: '100%', height: 'auto', objectFit: 'cover', borderRadius: 12, order: whatCoversImgPos === 'left' ? 0 : 1 }} />
                ) : whatCoversImgPlaceholder ? (
                  <div style={{ width: '100%', height: 280, borderRadius: 12, background: '#F5F7FA', border: '2px dashed #D1D5DB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 13, fontWeight: 600, order: whatCoversImgPos === 'left' ? 0 : 1 }}>
                    {whatCoversImgPlaceholder}
                  </div>
                ) : null}
              </div>

            </div>
          </section>
        )}

        {/* ── Who Is It For + What You Get ─────────────────────────────────── */}
        {(!hidden(whoRaw) || !hidden(whatRaw)) && (
          <section style={{ background: '#F9FAFB', padding: 'clamp(48px,7vw,80px) 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40 }}>
                {/* Who Is It For */}
                {!hidden(whoRaw) && (
                  <div>
                    {cmsVisible(wc ?? {}, 'heading') && (
                      <h3 style={{ ...fw(wc, 'heading'), fontSize: 14, fontWeight: 800, color: '#0D2E5A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                        {whoHead}
                      </h3>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {whoItems.map((who) => (
                        <div key={who} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px', borderRadius: 8,
                          background: platform.bgColor,
                          border: `1px solid ${platform.color}22`,
                        }}>
                          <span style={{ fontSize: 14, color: platform.color, fontWeight: 700, flexShrink: 0 }}>✓</span>
                          <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>{who}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* What You Get */}
                {!hidden(whatRaw) && (
                  <div>
                    {cmsVisible(gc ?? {}, 'heading') && (
                      <h3 style={{ ...fw(gc, 'heading'), fontSize: 14, fontWeight: 800, color: '#0D2E5A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                        {getHead}
                      </h3>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {getItems.map((item) => (
                        <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: platform.color, color: '#fff',
                            fontSize: 11, fontWeight: 700, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginTop: 1,
                          }}>✓</span>
                          <span style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Modules Roadmap (from config) ────────────────────────────────── */}
        {!hidden(moduleRaw) && platform.modules.length > 0 && (
          <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <div style={{ marginBottom: 40 }}>
                {cmsVisible(mc ?? {}, 'heading') && (
                  <h2 style={{ ...fw(mc, 'heading'), fontSize: 'clamp(20px,3vw,30px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>
                    {moduleGuideHead}
                  </h2>
                )}
                <CmsField
                  content={mc ?? { subheading: moduleGuideSub }}
                  field="subheading"
                  as="p"
                  style={{ fontSize: 15, color: '#6B7280', maxWidth: 600 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {platform.modules.map((mod) => (
                  <div key={mod.number} style={{
                    background: '#fff', borderRadius: 12,
                    border: '1px solid #E5E7EB',
                    padding: '24px 28px',
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: moduleCircleColor(mod.status),
                      color: '#fff', fontSize: 16, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {mod.number}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A' }}>
                          Module {mod.number}: {mod.name}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 9px',
                          borderRadius: 20, letterSpacing: '0.04em',
                          ...moduleBadgeStyle(mod.status),
                        }}>
                          {mod.status === 'complete' ? 'COMPLETE' : mod.status === 'in_progress' ? 'IN PROGRESS' : 'PLANNED'}
                        </span>
                      </div>

                      <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.65, marginBottom: 12 }}>
                        {mod.description}
                      </p>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        {mod.tabs.map((tab) => (
                          <span key={tab} style={{
                            fontSize: 11, fontWeight: 600, padding: '3px 10px',
                            borderRadius: 4, background: '#F3F4F6',
                            color: '#374151', border: '1px solid #E5E7EB',
                          }}>
                            {tab}
                          </span>
                        ))}
                      </div>

                      <div style={{ fontSize: 12, fontWeight: 700, color: moduleCircleColor(mod.status) }}>
                        {moduleStatusLabel(mod.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        {!hidden(ctaRaw) && (
          <section style={{
            background: platform.color,
            padding: 'clamp(48px,7vw,80px) 40px',
            textAlign: 'center',
          }}>
            <div style={{ maxWidth: 600, margin: '0 auto' }}>
              {cmsVisible(cc ?? {}, 'heading') && (
                <h2 style={{
                  ...fw(cc, 'heading'),
                  fontSize: 'clamp(22px,4vw,36px)', fontWeight: 800,
                  color: '#fff', marginBottom: 12, lineHeight: 1.2,
                }}>
                  {ctaHead}
                </h2>
              )}
              <CmsField
                content={cc ?? { description: ctaDesc }}
                field="description"
                as="p"
                style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}
              />
              {cmsVisible(cc ?? {}, 'cta_text') && ctaText && ctaUrl && (
                <a href={`${APP_URL}${ctaUrl}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#fff', color: platform.color,
                  fontWeight: 800, fontSize: 16, padding: '14px 40px',
                  borderRadius: 8, textDecoration: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                }}>
                  {ctaText}
                </a>
              )}
            </div>
          </section>
        )}

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
            <Link href="/modeling" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Modeling Hub</Link>
            <a href={`${APP_URL}/signin`} style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</a>
          </div>
        </footer>
      </div>
    );
  }

  // ── COMING SOON layout ──────────────────────────────────────────────────
  const dbSlugSet = new Set(dbModules.map((m) => m.slug));
  const livePlatforms = PLATFORMS.filter(
    (p) => dbSlugSet.has(p.slug) && dbModules.find((m) => m.slug === p.slug)?.status === 'live'
  );

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        padding: 'clamp(48px,7vw,88px) 40px clamp(56px,8vw,96px)',
        color: '#fff',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link href="/modeling" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>Modeling Hub</Link>
            <span>→</span>
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>{displayName}</span>
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: platform.bgColor, borderRadius: 6,
            padding: '4px 12px', fontSize: 11, fontWeight: 800,
            color: platform.color, letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
          }}>
            {dbEntry.icon || platform.icon} {platform.shortName}
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(180,83,9,0.18)', border: '1px solid rgba(180,83,9,0.45)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: '#FDE68A', fontWeight: 700, marginLeft: 10, letterSpacing: '0.04em',
          }}>
            🔜 Coming Soon
          </div>

          <h1 style={{
            fontSize: 'clamp(26px,4.5vw,48px)', fontWeight: 800,
            color: '#fff', lineHeight: 1.15, marginBottom: 16,
            letterSpacing: '-0.02em', marginTop: 24,
          }}>
            {displayName}
          </h1>

          <p style={{
            fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.65, marginBottom: 32, maxWidth: 600,
          }}>
            {platform.tagline}
          </p>

          <Link href="/modeling" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'transparent', color: '#fff',
            fontWeight: 700, fontSize: 15, padding: '13px 32px',
            borderRadius: 8, textDecoration: 'none',
            border: '2px solid rgba(255,255,255,0.35)',
          }}>
            ← Back to Modeling Hub
          </Link>
        </div>
      </section>

      {/* ── What It Will Cover ────────────────────────────────────────────── */}
      <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(20px,3vw,30px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 20 }}>
            What This Platform Will Cover
          </h2>

          <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 40, maxWidth: 760 }}>
            {platform.longDescription}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                Who Is It For
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {platform.whoIsItFor.map((who) => (
                  <div key={who} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 8,
                    background: platform.bgColor,
                    border: `1px solid ${platform.color}22`,
                  }}>
                    <span style={{ fontSize: 14, color: platform.color, fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>{who}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                What You Will Get
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {platform.whatYouGet.map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: platform.color, color: '#fff',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}>✓</span>
                    <span style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Coming Soon Banner ────────────────────────────────────────────── */}
      <section style={{ background: '#FFFBEB', padding: 'clamp(40px,6vw,64px) 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: '#FEF3C7', border: '1px solid #FDE68A',
            borderRadius: 10, padding: '10px 20px', marginBottom: 24,
            boxShadow: '0 2px 8px rgba(180,83,9,0.1)',
          }}>
            <span style={{ fontSize: 20 }}>🔜</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#B45309' }}>Launching Soon</span>
          </div>

          <h2 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 14 }}>
            This platform is in development
          </h2>
          <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 28 }}>
            The {displayName} platform is currently being built. In the meantime, explore the live platforms available now or register to be notified when this platform launches.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/modeling" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: '#1B4F8A', color: '#fff',
              fontWeight: 700, fontSize: 14, padding: '11px 28px',
              borderRadius: 7, textDecoration: 'none',
            }}>
              See All Platforms →
            </Link>
            <a href={`${APP_URL}/register`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'transparent', color: '#B45309',
              fontWeight: 700, fontSize: 14, padding: '10px 26px',
              borderRadius: 7, textDecoration: 'none',
              border: '1.5px solid #F59E0B',
            }}>
              Register for Updates →
            </a>
          </div>
        </div>
      </section>

      {/* ── Other Live Platforms ──────────────────────────────────────────── */}
      {livePlatforms.length > 0 && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 28, textAlign: 'center' }}>
              Available Now
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24 }}>
              {livePlatforms.map((p) => (
                <div key={p.slug} style={{
                  background: '#fff', borderRadius: 12,
                  border: '1px solid #E5E7EB', borderLeft: `4px solid ${p.color}`,
                  padding: '24px 22px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 28 }}>{p.icon}</span>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: p.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{p.shortName}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A' }}>{p.name}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6, marginBottom: 16 }}>{p.description}</p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <a href={`${APP_URL}/signin`} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 6, background: p.color, color: '#fff', textDecoration: 'none' }}>Launch →</a>
                    <Link href={`/modeling/${p.slug}`} style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 6, background: 'transparent', color: p.color, border: `1.5px solid ${p.color}`, textDecoration: 'none' }}>Learn More</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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
          <Link href="/modeling" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Modeling Hub</Link>
          <a href={`${APP_URL}/signin`} style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</a>
        </div>
      </footer>
    </div>
  );
}
