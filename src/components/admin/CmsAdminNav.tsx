'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

type NavItem =
  | { type?: undefined; label: string; href: string; icon: string }
  | { type: 'divider'; label: string };

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',       href: '/admin/cms',              icon: '🏠' },
  { type: 'divider',          label: 'Content' },
  { label: 'Page Content',    href: '/admin/content',          icon: '📝' },
  { label: 'Pages & Nav',     href: '/admin/pages',            icon: '🗂️' },
  { label: 'Modules',         href: '/admin/modules',          icon: '🧩' },
  { label: 'Articles',        href: '/admin/articles',         icon: '📰' },
  { label: 'Training',        href: '/admin/training',         icon: '🎓' },
  { label: 'Founder Profile', href: '/admin/founder',          icon: '👤' },
  { label: 'Media Library',   href: '/admin/media',            icon: '🖼️' },
  { type: 'divider',          label: 'Users & Platform' },
  { label: 'Users',           href: '/admin/users',            icon: '👥' },
  { label: 'Plan Config',     href: '/admin/plans',            icon: '📋' },
  { label: 'User Overrides',  href: '/admin/overrides',        icon: '🎯' },
  { label: 'Permissions',     href: '/admin/permissions',      icon: '🔐' },
  { label: 'White-Label',     href: '/admin/whitelabel',       icon: '🏷️' },
  { label: 'Branding',        href: '/admin/branding',         icon: '🎨' },
  { label: 'Announcements',   href: '/admin/announcements',    icon: '📢' },
  { label: 'Projects',        href: '/admin/projects',         icon: '📁' },
  { type: 'divider',          label: 'System' },
  { label: 'Audit Log',       href: '/admin/audit',            icon: '📋' },
  { label: 'System Health',   href: '/admin/health',           icon: '❤️' },
  { label: 'Settings',        href: '/admin/settings',         icon: '⚙️' },
];

interface Props {
  active?: string;
}

export function CmsAdminNav({ active: activeProp }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const active = activeProp ?? pathname;

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: '#0D2E5A',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      minHeight: '100vh',
      position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
    }}>
      {/* Brand */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link href="/admin/cms" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', marginBottom: 4 }}>
          <span style={{ fontSize: 20 }}>📐</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', lineHeight: 1 }}>FMP Admin</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Content Management</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ padding: '10px 8px', flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          if (item.type === 'divider') {
            return (
              <div key={item.label} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '12px 12px 4px', marginTop: 4 }}>
                {item.label}
              </div>
            );
          }
          const isActive = active === item.href || active?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
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
              <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <a href="/" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', borderRadius: 6, marginBottom: 2 }}>
          <span>🌐</span> View Live Site ↗
        </a>
        <Link href="/portal" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', borderRadius: 6, marginBottom: 8 }}>
          <span>◀</span> Back to Portal
        </Link>
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
    </aside>
  );
}
