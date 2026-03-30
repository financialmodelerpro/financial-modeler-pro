'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

type NavItem =
  | { type?: undefined; label: string; href: string; icon: string }
  | { type: 'divider'; label: string };

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',         href: '/admin/cms',                            icon: '🏠' },
  { type: 'divider',            label: 'Content' },
  { label: 'Page Content',      href: '/admin/content',                        icon: '📝' },
  { label: 'Pages & Nav',       href: '/admin/pages',                          icon: '🗂️' },
  { label: 'Articles',          href: '/admin/articles',                       icon: '📰' },
  { label: 'Testimonials',      href: '/admin/testimonials',                   icon: '⭐' },
  { label: 'Founder Profile',   href: '/admin/founder',                        icon: '👤' },
  { label: 'Media Library',     href: '/admin/media',                          icon: '🖼️' },
  { type: 'divider',            label: 'Modeling Hub' },
  { label: 'Modules',           href: '/admin/modules',                        icon: '🧩' },
  { label: 'Users',             href: '/admin/users',                          icon: '👥' },
  { label: 'Pricing',           href: '/admin/pricing',                        icon: '💰' },
  { label: 'User Overrides',    href: '/admin/overrides',                      icon: '🎯' },
  { label: 'Permissions',       href: '/admin/permissions',                    icon: '🔐' },
  { label: 'White-Label',       href: '/admin/whitelabel',                     icon: '🏷️' },
  { label: 'Branding',          href: '/admin/branding',                       icon: '🎨' },
  { label: 'Announcements',     href: '/admin/announcements',                  icon: '📢' },
  { label: 'Projects',          href: '/admin/projects',                       icon: '📁' },
  { type: 'divider',            label: 'Training Hub' },
  { label: 'Overview',          href: '/admin/training-hub',                   icon: '📊' },
  { label: 'Course Manager',    href: '/admin/training',                       icon: '🎓' },
  { label: 'Students',          href: '/admin/training-hub/students',          icon: '👨‍🎓' },
  { label: 'Certificates',      href: '/admin/training-hub/certificates',      icon: '🏆' },
  { label: 'Training Settings', href: '/admin/training-settings',              icon: '⚙️' },
  { type: 'divider',            label: 'System' },
  { label: 'Audit Log',         href: '/admin/audit',                          icon: '📋' },
  { label: 'System Health',     href: '/admin/health',                         icon: '❤️' },
  { label: 'Settings',          href: '/admin/settings',                       icon: '⚙️' },
];

interface Props {
  active?: string;
  /** href → count: shows a red badge next to that nav item */
  badges?: Record<string, number>;
}

export function CmsAdminNav({ active: activeProp, badges }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const active = activeProp ?? pathname;

  const [collapsed, setCollapsed]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore desktop collapse state from localStorage (client-only to avoid SSR mismatch)
  useEffect(() => {
    if (localStorage.getItem('adminSidebarCollapsed') === 'true') setCollapsed(true);
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('adminSidebarCollapsed', String(next));
  }

  const w = collapsed ? 64 : 240;

  return (
    <>
      {/* ── Dynamic CSS for mobile behavior ── */}
      <style>{`
        .admin-hamburger  { display: none !important; }
        .admin-mob-backdrop { display: none !important; }
        @media (max-width: 767px) {
          .admin-hamburger { display: flex !important; }
          .admin-sidebar-main {
            position: fixed !important;
            left: ${mobileOpen ? '0' : '-256px'} !important;
            top: 0 !important; height: 100vh !important;
            width: 240px !important;
            z-index: 1000 !important;
            transition: left 0.3s ease !important;
          }
          .admin-mob-backdrop {
            display: ${mobileOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 999;
          }
          .admin-collapse-toggle { display: none !important; }
        }
      `}</style>

      {/* Mobile hamburger button — fixed top-left */}
      <button
        className="admin-hamburger"
        onClick={() => setMobileOpen(true)}
        style={{
          position: 'fixed', top: 12, left: 12, zIndex: 998,
          width: 36, height: 36, borderRadius: 7,
          background: '#0D2E5A', border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', fontSize: 16, cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        }}
      >
        ☰
      </button>

      {/* Mobile backdrop */}
      <div className="admin-mob-backdrop" onClick={() => setMobileOpen(false)} />

      {/* ── Sidebar ── */}
      <aside
        className="admin-sidebar-main"
        style={{
          width: w,
          flexShrink: 0,
          background: '#0D2E5A',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          minHeight: '100vh',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 0.3s ease',
        }}
      >
        {/* Brand */}
        <div style={{
          padding: collapsed ? '20px 10px 16px' : '20px 16px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8,
        }}>
          <Link href="/admin/cms" title="FMP Admin"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>📐</span>
            {!collapsed && (
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', lineHeight: 1 }}>FMP Admin</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Content Management</div>
              </div>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ padding: collapsed ? '10px 4px' : '10px 8px', flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            if (item.type === 'divider') {
              // Hide section labels when collapsed
              if (collapsed) return null;
              return (
                <div key={item.label} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '12px 12px 4px', marginTop: 4 }}>
                  {item.label}
                </div>
              );
            }

            const isActive = active === item.href || active?.startsWith(item.href + '/');

            if (collapsed) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  onClick={() => setMobileOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '100%', padding: '9px 0', borderRadius: 7, marginBottom: 2,
                    background: isActive ? '#1B4F8A' : 'transparent',
                    borderLeft: isActive ? '3px solid #2EAA4A' : '3px solid transparent',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 7, marginBottom: 2,
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                  textDecoration: 'none',
                  background: isActive ? '#1B4F8A' : 'transparent',
                  borderLeft: isActive ? '3px solid #2EAA4A' : '3px solid transparent',
                }}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                {item.label}
                {(badges?.[item.href] ?? 0) > 0 && (
                  <span style={{ marginLeft: 'auto', background: '#DC2626', color: '#fff', borderRadius: 20, fontSize: 9, fontWeight: 800, padding: '1px 6px', minWidth: 16, textAlign: 'center', lineHeight: 1.6 }}>
                    {badges![item.href]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom links (expanded only) */}
        {!collapsed && (
          <div style={{ padding: '10px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <a href="/" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', borderRadius: 6, marginBottom: 2 }}>
              <span>🌐</span> View Live Site ↗
            </a>
            <a href="/training" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', borderRadius: 6, marginBottom: 2 }}>
              <span>🎓</span> Training Site ↗
            </a>
            <a href="/modeling" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', borderRadius: 6, marginBottom: 8 }}>
              <span>📐</span> Modeling Hub ↗
            </a>
            {session?.user && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.user.name ?? session.user.email}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Administrator</div>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  style={{ fontSize: 11, color: '#FCA5A5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, padding: '5px 10px', cursor: 'pointer', width: '100%' }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}

        {/* Collapsed bottom: sign out icon */}
        {collapsed && session?.user && (
          <div style={{ padding: '10px 4px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              title="Sign Out"
              onClick={() => signOut({ callbackUrl: '/' })}
              style={{ width: '100%', background: 'transparent', border: 'none', padding: '9px 0', cursor: 'pointer', color: '#FCA5A5', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              🚪
            </button>
          </div>
        )}

        {/* Desktop collapse toggle */}
        <button
          className="admin-collapse-toggle"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            margin: '8px auto 12px',
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>
    </>
  );
}
