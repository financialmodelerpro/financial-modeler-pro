'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';

interface NavPage {
  id: string;
  label: string;
  href: string;
  visible?: boolean;
  display_order?: number;
  can_toggle?: boolean;
}

const DEFAULT_PAGES: NavPage[] = [
  { id: '1', label: 'Home',          href: '/' },
  { id: '2', label: 'Modeling Hub',  href: '/modeling' },
  { id: '3', label: 'Training Hub',  href: '/training' },
  { id: '4', label: 'Articles',      href: '/articles' },
  { id: '5', label: 'About',         href: '/about' },
  { id: '6', label: 'Pricing',       href: '/pricing' },
  { id: '7', label: 'Contact',       href: '/contact' },
];

interface NavbarProps {
  navPages?: NavPage[];
  topOffset?: number;
  logoUrl?: string;
  logoAlt?: string;
}

export function Navbar({ navPages, topOffset = 0, logoUrl, logoAlt = 'Financial Modeler Pro' }: NavbarProps) {
  const pages = navPages ?? DEFAULT_PAGES;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <nav style={{
      position: 'fixed', top: topOffset, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', padding: '0 40px', height: 64,
      background: 'rgba(13,46,90,0.97)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoUrl} alt={logoAlt} style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
        ) : (
          <>
            <span style={{ fontSize: 24 }}>📐</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: '0.01em', lineHeight: 1 }}>
                Financial Modeler Pro
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
                Structured Modeling. Real-World Finance.
              </div>
            </div>
          </>
        )}
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

        {/* Login / Sign Up dropdown */}
        <div ref={ref} style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            Login / Sign Up
            <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
          </button>

          {open && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', minWidth: 220, zIndex: 200, overflow: 'hidden',
            }}>

              {/* ── Modeling Hub ── */}
              <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 15 }}>📐</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#1B3A6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Modeling Hub</span>
              </div>
              <Link href="/login" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 24px', textDecoration: 'none', color: '#374151', fontSize: 13, borderBottom: '1px solid #F9FAFB' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>🔑</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Sign In</span>
              </Link>
              <Link href="/login" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 12px 24px', textDecoration: 'none', color: '#374151', fontSize: 13 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>✏️</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Create Account</span>
              </Link>

              <div style={{ height: 1, background: '#E5E7EB' }} />

              {/* ── Training Hub ── */}
              <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 15 }}>🎓</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#1B3A6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Training Hub</span>
              </div>
              <Link href="/training/login" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 24px', textDecoration: 'none', color: '#374151', fontSize: 13, borderBottom: '1px solid #F9FAFB' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>🔑</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Sign In</span>
              </Link>
              <Link href="/training/register" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 14px 24px', textDecoration: 'none', color: '#374151', fontSize: 13 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>✏️</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Create Account</span>
              </Link>

            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
