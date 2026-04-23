import Link from 'next/link';

export const metadata = {
  title: 'Page not found - Financial Modeler Pro',
  robots: { index: false, follow: false },
};

/**
 * Global 404 page. Replaces Next.js's default "This page could not be
 * found." with a branded card that offers useful exits - the most
 * common source of 404s here is a mistyped admin URL or a stale
 * bookmark from an older deployment.
 */
export default function NotFound() {
  const NAVY = '#0D2E5A';
  const GOLD = '#C9A84C';
  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${NAVY} 0%, #1F3864 60%, #0A1F3D 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#fff', borderRadius: 16,
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, #B8962E)` }} />
        <div style={{ padding: '48px 40px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🧭</div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: GOLD, textTransform: 'uppercase', marginBottom: 4 }}>
            404
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>
            Page not found
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 28px', lineHeight: 1.6 }}>
            The URL you tried does not exist. If you were trying to reach the admin panel, the link below will take you there.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Link
              href="/admin"
              style={{
                display: 'block', padding: '12px 20px', borderRadius: 8,
                background: NAVY, color: '#fff',
                fontSize: 14, fontWeight: 700, textDecoration: 'none',
              }}
            >
              Go to Admin Sign In
            </Link>
            <Link
              href="/"
              style={{
                display: 'block', padding: '12px 20px', borderRadius: 8,
                background: 'transparent', color: NAVY,
                fontSize: 13, fontWeight: 600, textDecoration: 'none',
                border: '1px solid #D1D5DB',
              }}
            >
              Back to Main Site
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
