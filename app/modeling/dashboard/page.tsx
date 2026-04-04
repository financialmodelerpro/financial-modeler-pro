'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { PLATFORMS } from '@/src/config/platforms';
import type { Platform } from '@/src/config/platforms';
import { useInactivityLogout } from '@/src/hooks/useInactivityLogout';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

// Map platform slug → internal route
const PLATFORM_ROUTES: Record<string, string> = {
  'real-estate': '/refm',
};

function PlatformCard({ platform }: { platform: Platform }) {
  const route = PLATFORM_ROUTES[platform.slug];
  const isLive = platform.status === 'live';

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      border: `1.5px solid ${isLive ? platform.color + '33' : '#E5E7EB'}`,
      padding: '28px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      position: 'relative',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      ...(isLive ? { boxShadow: '0 2px 12px rgba(0,0,0,0.06)' } : { opacity: 0.72 }),
    }}>
      {/* Status badge */}
      {!isLive && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          background: '#F3F4F6', color: '#6B7280',
          fontSize: 11, fontWeight: 700, padding: '3px 10px',
          borderRadius: 20, letterSpacing: '0.04em',
        }}>
          COMING SOON
        </div>
      )}
      {isLive && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          background: '#D1FAE5', color: '#065F46',
          fontSize: 11, fontWeight: 700, padding: '3px 10px',
          borderRadius: 20, letterSpacing: '0.04em',
        }}>
          LIVE
        </div>
      )}

      {/* Icon + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12,
          background: platform.bgColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, flexShrink: 0,
        }}>
          {platform.icon}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: platform.color, letterSpacing: '0.06em', marginBottom: 3 }}>
            {platform.shortName}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>
            {platform.name}
          </div>
        </div>
      </div>

      {/* Tagline */}
      <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>
        {platform.tagline}
      </p>

      {/* CTA */}
      {isLive && route ? (
        <Link href={route} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: platform.color, color: '#fff',
          fontWeight: 700, fontSize: 13, padding: '10px 20px',
          borderRadius: 8, textDecoration: 'none', marginTop: 'auto',
        }}>
          Open Platform →
        </Link>
      ) : (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#F3F4F6', color: '#9CA3AF',
          fontWeight: 600, fontSize: 13, padding: '10px 20px',
          borderRadius: 8, marginTop: 'auto', cursor: 'default',
        }}>
          Notify Me When Live
        </div>
      )}
    </div>
  );
}

export default function ModelingDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useInactivityLogout({
    onLogout: async () => { await signOut({ redirect: false }); },
    redirectUrl: '/modeling/signin?reason=inactivity',
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/modeling/signin');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#6B7280', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!session?.user) return null;

  const user = session.user;
  const initials = (user.name ?? user.email ?? 'U')
    .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{
        background: '#0D2E5A',
        padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 60, position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 1px 0 rgba(255,255,255,0.08)',
      }}>
        {/* Logo / brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href={`${MAIN_URL}/`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>📐</div>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>
              FMP <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400 }}>| Modeling Hub</span>
            </span>
          </a>
        </div>

        {/* User menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 700,
            }}>
              {initials}
            </div>
            <div>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                {user.name ?? 'User'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                {user.email}
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/modeling' })}
            style={{
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7,
              fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px' }}>

        {/* Welcome */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0D2E5A', margin: '0 0 8px' }}>
            Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
            Select a platform below to open your financial modeling workspace.
          </p>
        </div>

        {/* Platforms grid */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#374151', margin: 0 }}>
              Modeling Platforms
            </h2>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              {PLATFORMS.filter(p => p.status === 'live').length} live · {PLATFORMS.filter(p => p.status === 'coming_soon').length} coming soon
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 20,
          }}>
            {PLATFORMS.map(platform => (
              <PlatformCard key={platform.slug} platform={platform} />
            ))}
          </div>
        </div>

        {/* Footer links */}
        <div style={{ marginTop: 56, paddingTop: 24, borderTop: '1px solid #E5E7EB', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <a href={`${MAIN_URL}/`} style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>← Back to Home</a>
          <a href={`${MAIN_URL}/pricing`} style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>Pricing</a>
          <a href={`${MAIN_URL}/contact`} style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>Support</a>
          <Link href="/modeling" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>Modeling Hub Home</Link>
        </div>
      </div>
    </div>
  );
}
