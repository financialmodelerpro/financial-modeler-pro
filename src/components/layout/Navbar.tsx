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
  { id: '2', label: 'Modeling Hub',  href: '/modeling-hub' },
  { id: '3', label: 'Training Hub',  href: '/training' },
  { id: '4', label: 'Articles',      href: '/articles' },
  { id: '5', label: 'About',         href: '/about' },
  { id: '6', label: 'Pricing',       href: '/#pricing' },
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
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', minWidth: 240, zIndex: 200, overflow: 'hidden',
            }}>
              {/* Sign In */}
              <div style={{ padding: '6px 18px 2px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Sign In
              </div>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', textDecoration: 'none', color: '#374151', fontSize: 13 }}
              >
                <span style={{ fontSize: 16 }}>📐</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B' }}>Modeling Hub</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Sign in to your portal</div>
                </div>
              </Link>
              <Link
                href="/training/login"
                onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', textDecoration: 'none', color: '#374151', fontSize: 13 }}
              >
                <span style={{ fontSize: 16 }}>🎓</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B' }}>Training Hub</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Sign in to your training account</div>
                </div>
              </Link>

              <div style={{ height: 1, background: '#F3F4F6', margin: '4px 12px' }} />

              {/* Sign Up */}
              <div style={{ padding: '6px 18px 2px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Create Account
              </div>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', textDecoration: 'none', color: '#374151', fontSize: 13 }}
              >
                <span style={{ fontSize: 16 }}>📐</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B' }}>Modeling Hub</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Financial modeling platforms</div>
                </div>
              </Link>
              <Link
                href="/training/register"
                onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px 14px', textDecoration: 'none', color: '#374151', fontSize: 13 }}
              >
                <span style={{ fontSize: 16 }}>🎓</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B' }}>Training Hub</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Free certification courses</div>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
