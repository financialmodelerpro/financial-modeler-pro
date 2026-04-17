import Link from 'next/link';

const NAVY      = '#1F3864';
const NAVY_DARK = '#0D2E5A';
const GOLD      = '#C9A84C';

export default function AdminLandingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 60%, #0A1F3D 100%)`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#fff', borderRadius: 16,
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>
        {/* Gold accent bar */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, #B8962E)` }} />

        <div style={{ padding: '48px 40px 44px', textAlign: 'center' }}>
          {/* Logo mark */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: 16, background: NAVY_DARK,
            boxShadow: '0 8px 24px rgba(13,46,90,0.35)', marginBottom: 20,
          }}>
            <span style={{ fontSize: 30 }}>🏢</span>
          </div>

          {/* Brand */}
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
            Financial Modeler Pro
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 28 }}>
            Admin Panel
          </div>

          <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY_DARK, margin: '0 0 10px', lineHeight: 1.2 }}>
            Welcome
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 8px', lineHeight: 1.6 }}>
            Restricted access - authorized personnel only.
          </p>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 36px' }}>
            Please sign in to access the administration dashboard.
          </p>

          {/* CTA */}
          <Link
            href="/admin/login"
            style={{
              display: 'block', width: '100%', padding: '14px 24px',
              fontSize: 15, fontWeight: 700, textAlign: 'center',
              background: `linear-gradient(135deg, ${GOLD}, #B8962E)`,
              color: '#1A1A1A', borderRadius: 9, textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(201,168,76,0.35)',
              letterSpacing: '0.01em', boxSizing: 'border-box',
            }}
          >
            Sign In to Admin Panel →
          </Link>

          <p style={{ marginTop: 24, fontSize: 12 }}>
            <Link href="/" style={{ color: '#9CA3AF', textDecoration: 'none' }}>
              ← Back to Main Site
            </Link>
          </p>
        </div>
      </div>

      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: 16 }}>v8.0.1</p>
    </div>
  );
}
