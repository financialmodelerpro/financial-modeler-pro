'use client';

import Link from 'next/link';

interface NavPage {
  id: string;
  label: string;
  href: string;
  visible?: boolean;
  display_order?: number;
  can_toggle?: boolean;
}

const DEFAULT_PAGES: NavPage[] = [
  { id: '1', label: 'Home',             href: '/' },
  { id: '2', label: 'Modeling Hub',     href: '/#modules' },
  { id: '3', label: 'Training Academy', href: '/training' },
  { id: '4', label: 'Articles',         href: '/articles' },
  { id: '5', label: 'About',            href: '/about' },
  { id: '6', label: 'Pricing',          href: '/#pricing' },
];

interface NavbarProps {
  navPages?: NavPage[];
  topOffset?: number;
}

export function Navbar({ navPages, topOffset = 0 }: NavbarProps) {
  const pages = navPages ?? DEFAULT_PAGES;
  return (
    <nav style={{
      position: 'fixed', top: topOffset, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', padding: '0 40px', height: 64,
      background: 'rgba(13,46,90,0.97)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <span style={{ fontSize: 24 }}>📐</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: '0.01em', lineHeight: 1 }}>
            Financial Modeler Pro
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
            Structured Modeling. Real-World Finance.
          </div>
        </div>
      </Link>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {pages.map(({ id, label, href }) => (
          <Link
            key={id}
            href={href}
            style={{ padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)', textDecoration: 'none' }}
          >
            {label}
          </Link>
        ))}
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 8px' }} />
        <Link
          href="/portal"
          style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700, textDecoration: 'none', background: '#1B4F8A', color: '#fff' }}
        >
          Go to Portal →
        </Link>
      </div>
    </nav>
  );
}
