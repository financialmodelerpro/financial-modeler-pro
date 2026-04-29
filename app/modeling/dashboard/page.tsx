'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PLATFORMS } from '@/src/hubs/modeling/config/platforms';
import type { Platform } from '@/src/hubs/modeling/config/platforms';
import { useInactivityLogout } from '@/src/shared/hooks/useInactivityLogout';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://app.financialmodelerpro.com';

const PLATFORM_ROUTES: Record<string, string> = {
  'real-estate': `${APP_URL}/refm`,
};

const SIDEBAR_W = 260;
const SIDEBAR_W_COLLAPSED = 60;

type Theme = ReturnType<typeof buildTheme>;

function buildTheme(dark: boolean) {
  return dark
    ? {
        bg:        '#0F1419',
        surface:   '#1A222F',
        surfaceAlt:'#222B3A',
        border:    '#2A3543',
        heading:   '#F1F5F9',
        body:      '#D1D5DB',
        muted:     '#94A3B8',
        sidebarBg: '#081628',
        topbarBg:  '#081628',
        cardShadow:'0 2px 8px rgba(0,0,0,0.45)',
        cardShadowHover: '0 6px 28px rgba(0,0,0,0.55)',
        liveBg:    'rgba(16,185,129,0.18)',
        liveFg:    '#6EE7B7',
        comingBg:  'rgba(255,255,255,0.06)',
        comingFg:  '#9CA3AF',
        dropdownBg:'#1F2937',
        warm:      '#F0B400',
      }
    : {
        bg:        '#F5F7FA',
        surface:   '#FFFFFF',
        surfaceAlt:'#F9FAFB',
        border:    '#E5E7EB',
        heading:   '#0D2E5A',
        body:      '#374151',
        muted:     '#6B7280',
        sidebarBg: '#0D2E5A',
        topbarBg:  '#0D2E5A',
        cardShadow:'0 2px 8px rgba(0,0,0,0.05)',
        cardShadowHover: '0 6px 28px rgba(0,0,0,0.13)',
        liveBg:    '#D1FAE5',
        liveFg:    '#065F46',
        comingBg:  '#F3F4F6',
        comingFg:  '#9CA3AF',
        dropdownBg:'#FFFFFF',
        warm:      '#7C2D12',
      };
}

interface NavItem {
  id: string;
  icon: string;
  label: string;
  href?: string;
  badge?: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',    icon: '🏠', label: 'Dashboard' },
  { id: 'projects',     icon: '📁', label: 'My Projects',  disabled: true, badge: 'Soon' },
  { id: 'certificates', icon: '🏆', label: 'Certificates', disabled: true, badge: 'Soon' },
  { id: 'settings',     icon: '⚙️', label: 'Settings', href: '/settings' },
];

function PlatformCard({ platform, theme }: { platform: Platform; theme: Theme }) {
  const [hovered, setHovered] = useState(false);
  const route  = PLATFORM_ROUTES[platform.slug];
  const isLive = platform.status === 'live';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: theme.surface,
        borderRadius: 14,
        border: `1.5px solid ${isLive && hovered ? platform.color + '55' : isLive ? platform.color + '28' : theme.border}`,
        padding: '24px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
        transition: 'box-shadow 0.18s, border-color 0.18s, transform 0.18s',
        boxShadow: isLive && hovered ? `0 6px 28px ${platform.color}33` : isLive ? theme.cardShadow : 'none',
        transform: isLive && hovered ? 'translateY(-2px)' : 'none',
        opacity: isLive ? 1 : 0.7,
      }}
    >
      <div style={{
        position: 'absolute', top: 14, right: 14,
        background: isLive ? theme.liveBg : theme.comingBg,
        color: isLive ? theme.liveFg : theme.comingFg,
        fontSize: 10, fontWeight: 700,
        padding: '3px 9px', borderRadius: 20,
        letterSpacing: '0.05em',
      }}>
        {isLive ? 'LIVE' : 'COMING SOON'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: platform.bgColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, flexShrink: 0,
        }}>
          {platform.icon}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: platform.color, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3 }}>
            {platform.shortName}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.heading, lineHeight: 1.3 }}>
            {platform.name}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: theme.muted, lineHeight: 1.6, margin: 0, flexGrow: 1 }}>
        {platform.tagline}
      </p>

      {isLive && route ? (
        <a
          href={route}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: platform.color, color: '#fff',
            fontWeight: 700, fontSize: 13, padding: '10px 18px',
            borderRadius: 8, textDecoration: 'none',
            transition: 'opacity 0.15s',
          }}
        >
          Open Platform →
        </a>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: theme.comingBg, color: theme.comingFg,
          fontWeight: 600, fontSize: 12, padding: '10px 18px',
          borderRadius: 8,
        }}>
          Coming Soon
        </div>
      )}
    </div>
  );
}

export default function ModelingDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [profileDropdown, setProfileDropdown] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number>(28);
  const profileRef = useRef<HTMLDivElement>(null);

  useInactivityLogout({
    onLogout: async () => { await signOut({ redirect: false }); },
    redirectUrl: '/signin?reason=inactivity&bypass=true',
  });

  // Restore sidebar state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('modelingSidebarCollapsed') === 'true') {
      setCollapsed(true);
    }
    // Dark mode: localStorage wins, otherwise system pref
    const stored = localStorage.getItem('modelingDarkMode');
    if (stored === 'true' || stored === 'false') {
      setDarkMode(stored === 'true');
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true);
    }
  }, []);

  // Fetch CMS logo (same pattern as Training Hub dashboard)
  useEffect(() => {
    fetch('/api/cms?section=header_settings&keys=logo_url,logo_height_px')
      .then(r => r.json())
      .then((d: { map?: Record<string, string> }) => {
        const url = d.map?.['header_settings__logo_url'];
        const h   = d.map?.['header_settings__logo_height_px'];
        if (url) setLogoUrl(url);
        if (h)   setLogoHeight(parseInt(h, 10) || 28);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/signin?bypass=true');
    }
  }, [status, router]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileDropdown(false);
      }
    }
    if (profileDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileDropdown]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('modelingSidebarCollapsed', String(next));
  }

  function toggleDark() {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('modelingDarkMode', String(next));
  }

  const theme = buildTheme(darkMode);

  if (status === 'loading') {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: theme.sidebarBg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!session?.user) return null;

  const user = session.user;
  const userName = user.name ?? user.email ?? 'User';
  const initials = userName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const isAdmin = (user as { role?: string }).role === 'admin';
  const sidebarW = collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W;
  const livePlatforms   = PLATFORMS.filter(p => p.status === 'live');
  const comingPlatforms = PLATFORMS.filter(p => p.status === 'coming_soon');

  const navItems: NavItem[] = [
    ...NAV_ITEMS,
    ...(isAdmin ? [{ id: 'admin', icon: '🛡️', label: 'Admin Panel', href: `${MAIN_URL}/admin` }] : []),
  ];

  return (
    <div
      data-theme={darkMode ? 'dark' : 'light'}
      style={{ fontFamily: "'Inter', sans-serif", background: theme.bg, minHeight: '100vh', color: theme.body }}
    >

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .mh-hamburger { display: none !important; }
        .mh-mob-backdrop { display: none !important; }
        @media (max-width: 767px) {
          .mh-hamburger { display: flex !important; }
          .mh-sidebar {
            position: fixed !important;
            left: ${mobileSidebarOpen ? '0' : '-270px'} !important;
            top: 0 !important; bottom: 0 !important;
            z-index: 200 !important;
            width: ${SIDEBAR_W}px !important;
            transition: left 0.3s ease !important;
          }
          .mh-mob-backdrop {
            display: ${mobileSidebarOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 199;
          }
          .mh-toggle-btn { display: none !important; }
          .mh-main { padding: 20px 16px 48px !important; }
          .mh-grid { grid-template-columns: 1fr !important; }
        }
        .mh-nav-item:hover { background: rgba(255,255,255,0.08) !important; }
      `}</style>

      <div className="mh-mob-backdrop" onClick={() => setMobileSidebarOpen(false)} />

      {/* TOP NAV */}
      <div style={{
        background: theme.topbarBg, padding: '0 20px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 150,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="mh-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            ☰
          </button>
          <a href={`${MAIN_URL}/`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Financial Modeler Pro" style={{ height: logoHeight, width: 'auto', display: 'block' }} />
            ) : (
              <>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📐</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Financial Modeler Pro</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Modeling Hub</div>
                </div>
              </>
            )}
          </a>
        </div>

        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setProfileDropdown(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: '#fff' }}
          >
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
              {initials}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userName}
            </span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
          </button>

          {profileDropdown && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: theme.dropdownBg, borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.18)', minWidth: 200, zIndex: 300, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
              <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${theme.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: theme.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
                <div style={{ fontSize: 11, color: theme.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
              <a href="/settings" onClick={() => setProfileDropdown(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', textDecoration: 'none', color: theme.body, fontSize: 13, fontWeight: 500 }}>⚙️ Settings</a>
              {isAdmin && (
                <a href={`${MAIN_URL}/admin`} onClick={() => setProfileDropdown(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', textDecoration: 'none', color: '#1A7A30', fontSize: 13, fontWeight: 700 }}>🛡️ Admin Panel →</a>
              )}
              <div style={{ borderTop: `1px solid ${theme.border}` }}>
                <button
                  onClick={() => { setProfileDropdown(false); signOut({ callbackUrl: '/' }); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: '#DC2626', fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                >
                  🚪 Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>

        <aside
          className="mh-sidebar"
          style={{
            width: sidebarW, flexShrink: 0,
            background: theme.sidebarBg,
            display: 'flex', flexDirection: 'column',
            position: 'sticky', top: 56,
            height: 'calc(100vh - 56px)',
            overflowY: 'auto', overflowX: 'hidden',
            transition: 'width 0.28s ease',
            borderRight: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className="mh-hamburger" style={{ padding: '12px 16px 0', justifyContent: 'flex-end' }}>
            <button onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>

          <div style={{ padding: collapsed ? '18px 8px' : '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                {initials}
              </div>
              {!collapsed && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: collapsed ? '10px 6px' : '10px 10px', flex: 1 }}>
            {!collapsed && (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '6px 4px', marginBottom: 4 }}>
                Navigation
              </div>
            )}

            {navItems.map(item => {
              const isActive = item.id === 'dashboard';
              return (
                <div
                  key={item.id}
                  title={collapsed ? item.label : undefined}
                  className="mh-nav-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '11px 0' : '10px 12px',
                    borderRadius: 8, marginBottom: 4,
                    borderLeft: isActive ? '3px solid #3B82F6' : '3px solid transparent',
                    background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                    cursor: item.disabled ? 'default' : 'pointer',
                    transition: 'background 0.15s',
                    opacity: item.disabled ? 0.5 : 1,
                    textDecoration: 'none', color: 'inherit',
                  }}
                  onClick={() => {
                    if (item.href && !item.disabled) {
                      window.location.href = item.href;
                    }
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#fff' : 'rgba(255,255,255,0.7)', flex: 1 }}>{item.label}</span>
                      {item.badge && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' }}>{item.badge}</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer: dark mode + sign out + collapse */}
          <div style={{ padding: collapsed ? '10px 6px' : '10px 10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {/* Dark mode toggle */}
            <div
              className="mh-nav-item"
              onClick={toggleDark}
              title={collapsed ? (darkMode ? 'Light Mode' : 'Dark Mode') : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '11px 0' : '10px 12px',
                borderRadius: 8, cursor: 'pointer',
                marginBottom: 6,
                borderLeft: '3px solid transparent',
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{darkMode ? '☀️' : '🌙'}</span>
              {!collapsed && <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
            </div>

            {/* Sign out */}
            <div
              className="mh-nav-item"
              onClick={() => signOut({ callbackUrl: '/' })}
              title={collapsed ? 'Sign Out' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '11px 0' : '10px 12px',
                borderRadius: 8, cursor: 'pointer',
                marginBottom: 6,
                borderLeft: '3px solid transparent',
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>🚪</span>
              {!collapsed && <span style={{ fontSize: 13, fontWeight: 500, color: '#FCA5A5' }}>Sign Out</span>}
            </div>

            <button
              className="mh-toggle-btn"
              onClick={toggleSidebar}
              style={{
                width: '100%', padding: '8px 0',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 7, color: 'rgba(255,255,255,0.5)',
                fontSize: 12, cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
            >
              {collapsed ? '→' : '← Collapse'}
            </button>
          </div>
        </aside>

        <main
          className="mh-main"
          style={{ flex: 1, padding: '32px 32px 60px', overflowY: 'auto', minWidth: 0 }}
        >
          <div style={{ marginBottom: 36 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: theme.heading, margin: '0 0 6px' }}>
              Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p style={{ fontSize: 13.5, color: theme.muted, margin: 0, lineHeight: 1.6 }}>
              Select a platform to open your modeling workspace.
            </p>
          </div>

          {livePlatforms.length > 0 && (
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: theme.body, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Available Platforms
                </h2>
                <span style={{ fontSize: 11, color: theme.muted }}>{livePlatforms.length} live</span>
              </div>
              <div
                className="mh-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}
              >
                {livePlatforms.map(p => <PlatformCard key={p.slug} platform={p} theme={theme} />)}
              </div>
            </section>
          )}

          {comingPlatforms.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: theme.body, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Coming Soon
                </h2>
                <span style={{ fontSize: 11, color: theme.muted }}>{comingPlatforms.length} platforms</span>
              </div>
              <div
                className="mh-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}
              >
                {comingPlatforms.map(p => <PlatformCard key={p.slug} platform={p} theme={theme} />)}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
