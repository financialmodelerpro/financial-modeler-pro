import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { PLATFORMS, getPlatform } from '@/src/config/platforms';
import type { PlatformModule } from '@/src/config/platforms';

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
    title: `${platform.name} | Modeling Hub — Financial Modeler Pro`,
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

  const isLive = platform.status === 'live';

  // ── LIVE platform layout ────────────────────────────────────────────────
  if (isLive) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
        <NavbarServer />
        <div style={{ height: 64 }} />

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section style={{
          background: `linear-gradient(135deg, ${platform.color}EE 0%, ${platform.color} 100%)`,
          padding: 'clamp(48px,7vw,88px) 40px clamp(56px,8vw,96px)',
          color: '#fff',
        }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {/* Breadcrumb */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link href="/modeling-hub" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
                Modeling Hub
              </Link>
              <span>→</span>
              <span style={{ color: 'rgba(255,255,255,0.85)' }}>{platform.name}</span>
            </div>

            {/* shortName badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: platform.bgColor, borderRadius: 6,
              padding: '4px 12px', fontSize: 11, fontWeight: 800,
              color: platform.color, letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: 20,
            }}>
              {platform.icon} {platform.shortName}
            </div>

            <h1 style={{
              fontSize: 'clamp(26px,4.5vw,48px)', fontWeight: 800,
              color: '#fff', lineHeight: 1.15, marginBottom: 16,
              letterSpacing: '-0.02em',
            }}>
              {platform.name}
            </h1>

            <p style={{
              fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.75)',
              lineHeight: 1.65, marginBottom: 28, maxWidth: 620,
            }}>
              {platform.tagline}
            </p>

            {/* Live status */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.15)', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 700,
              color: '#fff', marginBottom: 32,
            }}>
              ✓ LIVE — Available Now
            </div>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Link href="/login" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#fff', color: platform.color,
                fontWeight: 700, fontSize: 15, padding: '13px 32px',
                borderRadius: 8, textDecoration: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
              }}>
                Launch Platform →
              </Link>
              <Link href="/modeling-hub" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: '#fff',
                fontWeight: 700, fontSize: 15, padding: '13px 32px',
                borderRadius: 8, textDecoration: 'none',
                border: '2px solid rgba(255,255,255,0.4)',
              }}>
                ← Back to Modeling Hub
              </Link>
            </div>
          </div>
        </section>

        {/* ── What It Covers ───────────────────────────────────────────────── */}
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'clamp(20px,3vw,30px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 20 }}>
              What This Platform Covers
            </h2>

            <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 40, maxWidth: 760 }}>
              {platform.longDescription}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40 }}>
              {/* Who Is It For */}
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

              {/* What You Get */}
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                  What You Get
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

        {/* ── Modules Roadmap ───────────────────────────────────────────────── */}
        {platform.modules.length > 0 && (
          <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <div style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: 'clamp(20px,3vw,30px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>
                  Step-by-Step Module Guide
                </h2>
                <p style={{ fontSize: 15, color: '#6B7280', maxWidth: 600 }}>
                  Build your model module by module — each unlocks when you complete the previous step.
                </p>
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
                    {/* Number circle */}
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: moduleCircleColor(mod.status),
                      color: '#fff', fontSize: 16, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {mod.number}
                    </div>

                    {/* Content */}
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

                      {/* Tab pills */}
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
        <section style={{
          background: platform.color,
          padding: 'clamp(48px,7vw,80px) 40px',
          textAlign: 'center',
        }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{
              fontSize: 'clamp(22px,4vw,36px)', fontWeight: 800,
              color: '#fff', marginBottom: 12, lineHeight: 1.2,
            }}>
              Ready to build your model?
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>
              Start with Module 1 — free, structured, and ready to use right now.
            </p>
            <Link href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#fff', color: platform.color,
              fontWeight: 800, fontSize: 16, padding: '14px 40px',
              borderRadius: 8, textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}>
              Launch Platform Free →
            </Link>
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
            <Link href="/modeling-hub" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Modeling Hub</Link>
            <Link href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</Link>
          </div>
        </footer>
      </div>
    );
  }

  // ── COMING SOON layout ──────────────────────────────────────────────────
  const livePlatforms = PLATFORMS.filter((p) => p.status === 'live');

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
          {/* Breadcrumb */}
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link href="/modeling-hub" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
              Modeling Hub
            </Link>
            <span>→</span>
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>{platform.name}</span>
          </div>

          {/* shortName badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: platform.bgColor, borderRadius: 6,
            padding: '4px 12px', fontSize: 11, fontWeight: 800,
            color: platform.color, letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
          }}>
            {platform.icon} {platform.shortName}
          </div>

          {/* Coming Soon badge */}
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
            {platform.name}
          </h1>

          <p style={{
            fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.65, marginBottom: 32, maxWidth: 600,
          }}>
            {platform.tagline}
          </p>

          <Link href="/modeling-hub" style={{
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
            {/* Who Is It For */}
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

            {/* What You Get */}
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
            <span style={{ fontSize: 15, fontWeight: 800, color: '#B45309' }}>
              Launching Soon
            </span>
          </div>

          <h2 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 14 }}>
            This platform is in development
          </h2>
          <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 28 }}>
            The {platform.name} platform is currently being built. In the meantime, explore the live platforms available now or register to be notified when this platform launches.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/modeling-hub" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: '#1B4F8A', color: '#fff',
              fontWeight: 700, fontSize: 14, padding: '11px 28px',
              borderRadius: 7, textDecoration: 'none',
            }}>
              See All Platforms →
            </Link>
            <Link href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'transparent', color: '#B45309',
              fontWeight: 700, fontSize: 14, padding: '10px 26px',
              borderRadius: 7, textDecoration: 'none',
              border: '1.5px solid #F59E0B',
            }}>
              Register for Updates →
            </Link>
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: p.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {p.shortName}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A' }}>{p.name}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6, marginBottom: 16 }}>
                    {p.description}
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Link href="/login" style={{
                      fontSize: 12, fontWeight: 700, padding: '7px 16px',
                      borderRadius: 6, background: p.color, color: '#fff',
                      textDecoration: 'none',
                    }}>
                      Launch →
                    </Link>
                    <Link href={`/modeling-hub/${p.slug}`} style={{
                      fontSize: 12, fontWeight: 700, padding: '6px 14px',
                      borderRadius: 6, background: 'transparent', color: p.color,
                      border: `1.5px solid ${p.color}`, textDecoration: 'none',
                    }}>
                      Learn More
                    </Link>
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
          <Link href="/modeling-hub" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Modeling Hub</Link>
          <Link href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</Link>
        </div>
      </footer>
    </div>
  );
}
