'use client';

import { useState, useRef, useEffect } from 'react';

interface NavPage {
  id: string;
  label: string;
  href: string;
  visible?: boolean;
  display_order?: number;
  can_toggle?: boolean;
}

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL   ?? 'https://app.financialmodelerpro.com';

const DEFAULT_PAGES: NavPage[] = [
  { id: '1', label: 'Home',               href: `${MAIN_URL}/`,                       display_order: 1 },
  { id: '2', label: 'Modeling Hub',       href: `${APP_URL}/modeling`,                display_order: 2 },
  { id: '3', label: 'Training Hub',       href: `${LEARN_URL}/training`,              display_order: 3 },
  { id: '8', label: 'Training Sessions',  href: `${LEARN_URL}/training-sessions`,     display_order: 4 },
  { id: '4', label: 'Articles',           href: `${MAIN_URL}/articles`,               display_order: 5 },
  { id: '6', label: 'Pricing',            href: `${MAIN_URL}/pricing`,                display_order: 6 },
  { id: '7', label: 'Contact',            href: `${MAIN_URL}/contact`,                display_order: 7 },
];

interface NavbarProps {
  navPages?: NavPage[];
  topOffset?: number;
  // New header settings props (from cms_content header_settings section)
  logoEnabled?: boolean;
  logoUrl?: string;
  logoWidthPx?: string;
  logoHeightPx?: string;
  logoPosition?: string;
  showBrandName?: boolean;
  brandName?: string;
  showTagline?: boolean;
  tagline?: string;
  iconUrl?: string;
  iconInHeader?: boolean;
  iconSizePx?: string;
  headerHeightPx?: string;
  headerPaddingTopPx?: string;
  headerPaddingBottomPx?: string;
  // Deprecated — kept for backward compat
  logoWidthInches?: string;
  logoHeightInches?: string;
}

export function Navbar({
  navPages, topOffset = 0,
  logoEnabled = true, logoUrl, logoWidthPx, logoHeightPx = '36', logoPosition: _logoPosition,
  showBrandName = true, brandName = 'Financial Modeler Pro',
  showTagline = true, tagline = 'Structured Modeling. Real-World Finance.',
  iconUrl, iconInHeader, iconSizePx = '20',
  headerHeightPx, headerPaddingTopPx, headerPaddingBottomPx,
  logoWidthInches, logoHeightInches,
}: NavbarProps) {
  const pages = (navPages ?? DEFAULT_PAGES)
    .filter(p => p.visible !== false)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));

  const [dropdownOpen, setDropdownOpen]   = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  // Logo sizing: new px props take priority, fall back to old inch conversion
  const logoH = parseInt(logoHeightPx || '') || (logoHeightInches ? Math.round(parseFloat(logoHeightInches) * 96) : 36);
  const logoW = (logoWidthPx ? parseInt(logoWidthPx) : undefined) ?? (logoWidthInches ? Math.round(parseFloat(logoWidthInches) * 96) : undefined);
  const hasLogo = logoEnabled && !!logoUrl;
  const iconSize = parseInt(iconSizePx || '20') || 20;

  const logo = (
    <a href={`${MAIN_URL}/`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
      {/* Header icon */}
      {iconInHeader && iconUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" style={{ width: iconSize, height: iconSize, objectFit: 'contain', flexShrink: 0 }} />
      )}
      {hasLogo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt={brandName} style={{ height: logoH, width: logoW ?? 'auto', objectFit: 'contain' }} />
          {showTagline && tagline && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }} dangerouslySetInnerHTML={{ __html: tagline }} />
          )}
        </>
      ) : (
        <>
          {!iconInHeader && <span style={{ fontSize: 24, flexShrink: 0 }}>📐</span>}
          <div>
            {showBrandName && (
              <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: '0.01em', lineHeight: 1 }}>
                {brandName}
              </div>
            )}
            {showTagline && tagline && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
                {tagline}
              </div>
            )}
            {!showBrandName && !showTagline && !iconInHeader && (
              <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</div>
            )}
          </div>
        </>
      )}
    </a>
  );

  return (
    <>
      {/* ── Mobile full-screen menu overlay ── */}
      {mobileMenuOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: '#0D2E5A',
          display: 'flex', flexDirection: 'column',
          padding: '0 0 32px',
          overflowY: 'auto',
        }}>
          {/* Mobile menu header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 64, borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
            <a href={`${MAIN_URL}/`} onClick={() => setMobileMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              <span style={{ fontSize: 20 }}>📐</span>
              <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</span>
            </a>
            <button
              onClick={() => setMobileMenuOpen(false)}
              style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ✕
            </button>
          </div>

          {/* Nav links */}
          <nav style={{ padding: '16px 20px', flex: 1 }}>
            {pages.map(({ id, label, href }) => (
              <a
                key={id}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                style={{ display: 'block', padding: '14px 0', fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Login / Sign Up section */}
          <div style={{ padding: '20px 20px 0', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Sign In / Register
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <a href={`${APP_URL}/signin`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 12px', borderRadius: 10, background: '#1B4F8A', color: '#fff', textDecoration: 'none', textAlign: 'center' }}>
                <span style={{ fontSize: 20 }}>📐</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Modeling Hub</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Sign In</span>
              </a>
              <a href={`${LEARN_URL}/signin`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 12px', borderRadius: 10, background: '#1A7A30', color: '#fff', textDecoration: 'none', textAlign: 'center' }}>
                <span style={{ fontSize: 20 }}>🎓</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Training Hub</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Sign In</span>
              </a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <a href={`${APP_URL}/register`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', borderRadius: 10, background: '#1B4F8A', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                Create Account →
              </a>
              <a href={`${LEARN_URL}/register`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', borderRadius: 10, background: '#2EAA4A', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                Register Free →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop / Mobile nav bar ── */}
      <style>{`
        .nav-desktop-links { display: flex; }
        .nav-divider        { display: block; }
        .nav-login-btn      { display: inline-flex; }
        .nav-hamburger      { display: none !important; }
        @media (max-width: 767px) {
          .nav-desktop-links { display: none !important; }
          .nav-divider        { display: none !important; }
          .nav-login-btn      { display: none !important; }
          .nav-hamburger      { display: flex !important; }
          nav[data-fmp-nav]   { padding: 0 16px !important; }
        }
      `}</style>

      <nav
        data-fmp-nav
        style={{
          position: 'fixed', top: topOffset, left: 0, right: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', padding: `${headerPaddingTopPx ? headerPaddingTopPx + 'px' : '0'} 40px ${headerPaddingBottomPx ? headerPaddingBottomPx + 'px' : '0'}`,
          minHeight: headerHeightPx ? parseInt(headerHeightPx) : 64, boxSizing: 'border-box',
          background: 'rgba(13,46,90,0.97)', borderBottom: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
        }}
      >
        {logo}

        <div style={{ flex: 1 }} />

        {/* Desktop nav links */}
        <div className="nav-desktop-links" style={{ alignItems: 'center', gap: 2 }}>
          {pages.map(({ id, label, href }) => (
            <a
              key={id}
              href={href}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)', textDecoration: 'none' }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Desktop divider */}
        <div className="nav-divider" style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 8px' }} />

        {/* Desktop Login / Sign Up dropdown */}
        <div ref={dropdownRef} className="nav-login-btn" style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            Sign In / Register
            <span style={{ fontSize: 10, opacity: 0.7 }}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {dropdownOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', minWidth: 220, zIndex: 200, overflow: 'hidden',
            }}>
              {/* Modeling Hub */}
              <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 15 }}>📐</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#1B3A6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Modeling Hub</span>
              </div>
              <a href={`${APP_URL}/signin`} onClick={() => setDropdownOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 24px', textDecoration: 'none', color: '#374151', fontSize: 13, borderBottom: '1px solid #F9FAFB' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>🔑</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Sign In</span>
              </a>
              <a href={`${APP_URL}/register`} onClick={() => setDropdownOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 12px 24px', textDecoration: 'none', color: '#374151', fontSize: 13 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>✏️</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Create Account</span>
              </a>

              <div style={{ height: 1, background: '#E5E7EB' }} />

              {/* Training Hub */}
              <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 15 }}>🎓</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#1B3A6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Training Hub</span>
              </div>
              <a href={`${LEARN_URL}/signin`} onClick={() => setDropdownOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 24px', textDecoration: 'none', color: '#374151', fontSize: 13, borderBottom: '1px solid #F9FAFB' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>🔑</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Sign In</span>
              </a>
              <a href={`${LEARN_URL}/register`} onClick={() => setDropdownOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 14px 24px', textDecoration: 'none', color: '#374151', fontSize: 13 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>✏️</span>
                <span style={{ fontWeight: 600, color: '#1B3A6B' }}>Create Account</span>
              </a>
            </div>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="nav-hamburger"
          onClick={() => setMobileMenuOpen(true)}
          style={{
            width: 40, height: 40, borderRadius: 8,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            alignItems: 'center', justifyContent: 'center',
            display: 'none', // overridden by CSS above on mobile
          }}
        >
          ☰
        </button>
      </nav>
    </>
  );
}
