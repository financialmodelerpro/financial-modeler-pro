'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import type { Session } from 'next-auth';
import type { PlatformEntry } from '@/src/types/branding.types';
import { UserSubscription } from '@/src/types/subscription.types';
import {
  PLATFORM_REGISTRY,
  USER_SUBSCRIPTION,
  hasAccess,
  getEffectivePlatforms,
} from '@/src/core/branding';
import { useBrandingStore } from '@/src/core/core-state';
import { useWhiteLabel } from '@/src/hooks/useWhiteLabel';
import BrandingSettingsPanel from '@/src/components/BrandingSettingsPanel';

// ── UserDropdown ─────────────────────────────────────────────────────────────

interface UserDropdownProps {
  session: Session;
  isAdmin: boolean;
}

function UserDropdown({ session, isAdmin }: UserDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const name  = session.user?.name  ?? session.user?.email ?? 'User';
  const email = session.user?.email ?? '';
  const initials = (session.user?.name ?? session.user?.email ?? 'U')
    .charAt(0)
    .toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative', marginRight: 8 }}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 30, height: 30,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)',
          border: '1.5px solid rgba(255,255,255,0.35)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.02em',
          transition: 'background 0.15s',
        }}
        aria-label="User menu"
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 220,
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          border: '1px solid #E8F0FB',
          zIndex: 9999,
          overflow: 'hidden',
          fontFamily: 'Inter, sans-serif',
        }}>
          {/* User info */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
          </div>

          {/* Menu items */}
          <div style={{ padding: '6px 0' }}>
            <a
              href="/settings"
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 16px', fontSize: 13, color: '#374151', textDecoration: 'none', fontWeight: 500 }}
            >
              My Profile
            </a>
            <a
              href="/portal"
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 16px', fontSize: 13, color: '#374151', textDecoration: 'none', fontWeight: 500 }}
            >
              My Projects
            </a>
            <a
              href="/settings"
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 16px', fontSize: 13, color: '#374151', textDecoration: 'none', fontWeight: 500 }}
            >
              Billing &amp; Plan
            </a>
            {isAdmin && (
              <a
                href="/admin/cms"
                onClick={() => setOpen(false)}
                style={{ display: 'block', padding: '8px 16px', fontSize: 13, color: '#1A7A30', textDecoration: 'none', fontWeight: 700 }}
              >
                Admin Panel →
              </a>
            )}
          </div>

          {/* Divider + Sign Out */}
          <div style={{ borderTop: '1px solid #F3F4F6', padding: '6px 0 8px' }}>
            <button
              onClick={() => { setOpen(false); signOut({ callbackUrl: '/' }); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                fontSize: 13,
                color: '#DC2626',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MyCertificates ────────────────────────────────────────────────────────────
// Additive-only section. Fetches training certs independently — never blocks portal.

interface CertCard {
  certificateId: string;
  studentName: string;
  course: string;
  issuedAt: string;
  certifierUrl: string;
}

function courseLabel(courseId: string): string {
  const map: Record<string, string> = {
    '3sfm': '3-Statement Financial Modeling',
    'bvm':  'Business Valuation Modeling',
    'both': 'Financial Modeling',
  };
  return map[courseId] ?? courseId.toUpperCase();
}

function formatCertDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

function MyCertificates({ userEmail }: { userEmail: string | null | undefined }) {
  const [certs,   setCerts]   = React.useState<CertCard[] | null>(null); // null = loading, [] = none
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!userEmail) { setLoading(false); setCerts([]); return; }
    let cancelled = false;
    fetch(`/api/training/certificate?email=${encodeURIComponent(userEmail)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((j: { success: boolean; data?: CertCard[] }) => {
        if (!cancelled) setCerts(j.success && Array.isArray(j.data) ? j.data : []);
      })
      .catch(() => { if (!cancelled) setCerts(null); }) // silently hide on any error
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userEmail]);

  // Silently hide section on API error
  if (!loading && certs === null) return null;

  const linkedInUrl = (certifierUrl: string) =>
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(certifierUrl)}`;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Section label — same style as portal */}
      <div className="portal-section-label">My Certificates 🏆</div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[1, 2].map(i => (
            <div key={i} style={{
              flex: '1 1 280px', maxWidth: 360,
              height: 112, borderRadius: 10,
              background: 'linear-gradient(90deg,rgba(255,255,255,0.06) 25%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0.06) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s infinite',
              border: '1px solid rgba(255,255,255,0.08)',
            }} />
          ))}
        </div>
      )}

      {/* Certificates found */}
      {!loading && certs && certs.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {certs.map(cert => (
            <div key={cert.certificateId} style={{
              flex: '1 1 280px', maxWidth: 400,
              background: 'var(--color-surface)',
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              borderLeft: '4px solid #C9A84C',
              padding: '16px 18px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 3 }}>
                {courseLabel(cert.course)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 2 }}>
                Completed {formatCertDate(cert.issuedAt)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 14, fontFamily: 'monospace' }}>
                ID: {cert.certificateId}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={cert.certifierUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: '#2EAA4A', color: '#fff', textDecoration: 'none',
                  }}
                >
                  View Certificate →
                </a>
                <a
                  href={linkedInUrl(cert.certifierUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: '#0A66C2', color: '#fff', textDecoration: 'none',
                  }}
                >
                  Share on LinkedIn →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No certificates yet — soft prompt */}
      {!loading && certs && certs.length === 0 && (
        <div style={{
          border: '2px dashed rgba(255,255,255,0.15)',
          borderRadius: 10,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          background: 'rgba(255,255,255,0.03)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 4 }}>
              Earn a free FMP certificate
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-meta)', lineHeight: 1.55, maxWidth: 440 }}>
              Complete a free training course and earn a verified certificate from Financial Modeler Pro.
            </div>
          </div>
          <a
            href="/training"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 18px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              background: '#2EAA4A', color: '#fff', textDecoration: 'none',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Visit Training Hub →
          </a>
        </div>
      )}

      <style>{`@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>
    </div>
  );
}

// ── PortalPage ────────────────────────────────────────────────────────────────

export default function PortalPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const { branding, setBranding, fetchRemote } = useBrandingStore();
  const { footerText } = useWhiteLabel();
  const [upgradeTarget, setUpgradeTarget] = React.useState<string | null>(null);
  const [brandingPanelOpen, setBrandingPanel] = React.useState(false);

  // Hydrate from Supabase on mount (falls back to localStorage silently)
  React.useEffect(() => { fetchRemote(); }, [fetchRemote]);

  const isAdmin = session?.user?.role === 'admin';

  const handleLaunch = (platformId: string) => {
    if (!hasAccess(platformId)) { setUpgradeTarget(platformId); return; }
    router.push('/refm');
  };

  const portalLogoEl = branding.portalLogoType === 'image' && branding.portalLogoImage
    ? (
      <div className="portal-header-logo-icon" style={{ padding: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', boxSizing: 'border-box' }}>
        <img
          src={branding.portalLogoImage}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          alt="portal logo"
        />
      </div>
    )
    : <div className="portal-header-logo-icon">{branding.portalLogoEmoji || '💼'}</div>;

  const userSubscription: UserSubscription = USER_SUBSCRIPTION;

  return (
    <div className="portal-root">
      {/* ── Portal Header ── */}
      <header className="portal-header">
        <div className="portal-header-logo">
          {portalLogoEl}
          <div>
            <div className="portal-header-title">{branding.portalTitle}</div>
            <div className="portal-header-subtitle">{branding.portalSubtitle}</div>
          </div>
        </div>
        <div className="portal-header-spacer" />
        {isAdmin && (
          <a href="/admin/cms" style={{
            marginRight: '8px',
            display: 'inline-flex', alignItems: 'center',
            gap: '5px', height: '28px', padding: '0 10px',
            borderRadius: 'var(--radius-sm)', fontSize: '11px', fontWeight: 600,
            border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)',
            color: '#fca5a5', textDecoration: 'none',
            transition: 'var(--transition)', fontFamily: 'Inter,sans-serif',
          }}>
            🛡️ Admin
          </a>
        )}
        {session?.user && (
          <UserDropdown session={session} isAdmin={isAdmin} />
        )}
        <span className="portal-header-version-pill">{userSubscription.plan} Plan</span>
      </header>

      {/* ── Portal Body ── */}
      <main className="portal-body">

        {/* Welcome Banner */}
        <div className="portal-welcome">
          <div>
            <h1>Welcome{session?.user?.name ? `, ${session.user.name}` : ''} to {branding.portalTitle}</h1>
            <p>{branding.portalDescription}</p>
          </div>
        </div>

        {/* My Certificates — additive section, loads independently */}
        <MyCertificates userEmail={session?.user?.email} />

        {/* Platform Cards */}
        <div className="portal-section-label">Available Platforms</div>
        <div className="portal-grid">
          {getEffectivePlatforms(branding).map((platform: PlatformEntry) => {
            const accessible   = hasAccess(platform.id);
            const isActive     = platform.status === 'active';
            const isLocked     = isActive && !accessible;
            const isComingSoon = platform.status === 'coming_soon';

            const showCustomPlatformLogo = platform.id === 'refm'
                && branding.platformLogoType === 'image'
                && branding.platformLogoImage;

            return (
              <div key={platform.id}
                   className={`portal-platform-card${isLocked ? ' locked' : ''}`}>
                <div className="portal-card-accent" style={{background: platform.accentColor}} />
                <div className="portal-card-body">
                  <div className="portal-card-icon-row">
                    <div className="portal-card-icon"
                         style={{background: platform.iconBg, overflow:'hidden', padding:0}}>
                      {showCustomPlatformLogo
                          ? <img src={branding.platformLogoImage!}
                                 style={{width:'100%',height:'100%',objectFit:'contain'}} alt="platform logo" />
                          : (platform.id === 'refm' && branding.platformLogoType === 'emoji')
                              ? <span style={{fontSize:'20px'}}>{branding.platformLogoEmoji || platform.icon}</span>
                              : <span style={{fontSize:'20px'}}>{platform.icon}</span>
                      }
                    </div>
                    <span className={`portal-card-status-pill ${isActive ? 'active' : 'soon'}`}>
                      {isActive ? 'Active' : 'Coming Soon'}
                    </span>
                  </div>
                  <p className="portal-card-name">{platform.name}</p>
                  <p className="portal-card-desc">{platform.description}</p>
                </div>
                <div className="portal-card-footer">
                  {isComingSoon ? (
                    <button className="portal-launch-btn coming-soon" disabled>🚧 Coming Soon</button>
                  ) : isLocked ? (
                    <button className="portal-launch-btn upgrade"
                        onClick={() => setUpgradeTarget(platform.id)}
                        title="Your current plan does not include this platform">
                      🔒 Upgrade to Access
                    </button>
                  ) : (
                    <button className="portal-launch-btn available"
                        onClick={() => handleLaunch(platform.id)}>
                      🚀 Launch Platform
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="portal-footer">
          <strong>{branding.portalTitle}</strong> · {footerText} ·{' '}
          <span>{userSubscription.plan} Plan</span> ·{' '}
          <span style={{color:'var(--color-success)',fontWeight:'var(--fw-semibold)'}}>
            {userSubscription.platforms.length} Platform{userSubscription.platforms.length !== 1 ? 's' : ''} Active
          </span>
        </div>
      </main>

      {/* ── Upgrade Modal ── */}
      {upgradeTarget && (() => {
        const p = PLATFORM_REGISTRY.find(x => x.id === upgradeTarget);
        if (!p) return null;
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}}
              onClick={() => setUpgradeTarget(null)}>
            <div style={{background:'var(--color-surface)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-modal)',width:'420px',maxWidth:'95vw',overflow:'hidden'}}
                onClick={e => e.stopPropagation()}>
              <div style={{background:'var(--color-primary-deep)',padding:'var(--sp-3) var(--sp-4)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:'var(--fw-bold)',color:'white',fontSize:'var(--font-section)'}}>{p.icon} {p.shortName}</div>
                  <div style={{fontSize:'var(--font-meta)',color:'rgba(255,255,255,0.5)',marginTop:'2px'}}>Platform access required</div>
                </div>
                <button onClick={() => setUpgradeTarget(null)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'1.2rem',lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:'var(--sp-4)'}}>
                <p style={{fontSize:'var(--font-body)',color:'var(--color-body)',lineHeight:1.6,margin:'0 0 var(--sp-3)'}}>
                  <strong>{p.name}</strong> is not included in your current <strong>{userSubscription.plan}</strong> plan.
                  Upgrade your subscription to unlock access to this platform.
                </p>
                <div style={{background:'var(--color-row-alt)',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)',padding:'var(--sp-2)',marginBottom:'var(--sp-3)'}}>
                  <div style={{fontSize:'var(--font-micro)',color:'var(--color-meta)',marginBottom:'4px',fontWeight:'var(--fw-semibold)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Current Plan</div>
                  <div style={{fontWeight:'var(--fw-bold)',color:'var(--color-heading)',fontSize:'var(--font-body)'}}>{userSubscription.plan} · {userSubscription.platforms.length} Platform{userSubscription.platforms.length !== 1 ? 's' : ''}</div>
                </div>
                <div style={{display:'flex',gap:'var(--sp-1)',justifyContent:'flex-end'}}>
                  <button onClick={() => setUpgradeTarget(null)}
                      style={{padding:'var(--sp-1) var(--sp-2)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-sm)',background:'var(--color-surface)',cursor:'pointer',fontSize:'var(--font-body)',color:'var(--color-body)',fontWeight:'var(--fw-medium)'}}>
                    Cancel
                  </button>
                  <button onClick={() => { setUpgradeTarget(null); alert('Contact your administrator or visit the billing portal to upgrade your subscription.'); }}
                      style={{padding:'var(--sp-1) var(--sp-2)',background:'var(--color-primary)',color:'white',border:'none',borderRadius:'var(--radius-sm)',cursor:'pointer',fontSize:'var(--font-body)',fontWeight:'var(--fw-semibold)'}}>
                    Contact Sales →
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Branding Settings Panel ── */}
      {brandingPanelOpen && (
        <BrandingSettingsPanel
          branding={branding}
          onSave={setBranding}
          onClose={() => setBrandingPanel(false)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
