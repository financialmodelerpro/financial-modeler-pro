'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: { label: string; href: string; icon: string }[] = [
  { label: 'Issued Certificates', href: '/admin/training-hub/certificates', icon: '🏆' },
  { label: 'Templates & Sync',    href: '/admin/certificates',              icon: '📁' },
  { label: 'Certificate Editor',  href: '/admin/certificate-editor',        icon: '🎨' },
  { label: 'Badge Editor',        href: '/admin/badge-editor',              icon: '🎖' },
  { label: 'Transcript Editor',   href: '/admin/transcript-editor',         icon: '📄' },
];

export function CertificatesHubTabs() {
  const pathname = usePathname();

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E8F0FB',
        borderRadius: 12,
        padding: 6,
        marginBottom: 24,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        overflowX: 'auto',
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              color: active ? '#fff' : '#374151',
              background: active ? '#1B4F8A' : 'transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            <span style={{ fontSize: 14 }}>{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
