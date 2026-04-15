'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard, BookOpen, Lock, Video, Award, Medal,
  FileText, User, LogOut, ChevronLeft, ChevronRight, Star,
} from 'lucide-react';
import { getTrainingSession, clearTrainingSession } from '@/src/lib/training/training-session';
import { useInactivityLogout } from '@/src/hooks/useInactivityLogout';
import { WelcomeModal } from './WelcomeModal';

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

interface TrainingShellProps {
  children: ReactNode;
  /** Currently active nav key for sidebar highlight */
  activeNav?: 'dashboard' | 'live-sessions' | 'certificates';
  /** When true, show only the top header bar — no sidebar, no footer */
  headerOnly?: boolean;
  /** CMS logo URL */
  logoUrl?: string;
  /** CMS logo height in px */
  logoHeightPx?: string;
}

export function TrainingShell({ children, activeNav, headerOnly, logoUrl: logoUrlProp, logoHeightPx: logoHeightPxProp = '36' }: TrainingShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [session, setSession] = useState<{ email: string; registrationId: string } | null>(null);
  const [cmsLogo, setCmsLogo] = useState<{ url?: string; height?: string }>({});

  // If no logo prop was passed (client-side usage), fetch from CMS
  useEffect(() => {
    if (logoUrlProp) return;
    fetch('/api/cms?section=header_settings&keys=logo_url,logo_height_px')
      .then(r => r.json())
      .then((d: { map?: Record<string, string> }) => {
        const m = d.map ?? {};
        const url = m['header_settings__logo_url'];
        const h = m['header_settings__logo_height_px'];
        if (url) setCmsLogo({ url, height: h || '36' });
      })
      .catch(() => {});
  }, [logoUrlProp]);

  const logoUrl = logoUrlProp || cmsLogo.url;
  const logoHeightPx = logoUrlProp ? logoHeightPxProp : (cmsLogo.height || logoHeightPxProp);
  // Live session indicators
  const [hasLiveNow, setHasLiveNow] = useState(false);
  const [upcomingCount, setUpcomingCount] = useState(0);
  // Live sessions accordion
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [sessionsList, setSessionsList] = useState<Array<{ id: string; title: string; session_type: string; duration_minutes: number | null; scheduled_datetime: string }>>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  useInactivityLogout({
    logoutUrl: '/api/training/logout',
    redirectUrl: '/signin?reason=inactivity',
  });

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/signin'); return; }
    setSession(sess);
  }, [router]);

  useEffect(() => {
    if (localStorage.getItem('fmp_sidebar_collapsed') === 'true') setSidebarCollapsed(true);
  }, []);

  // Fetch live session indicators
  useEffect(() => {
    fetch('/api/training/live-sessions?type=upcoming')
      .then(r => r.json())
      .then((j: { sessions?: { id: string; session_type: string }[] }) => {
        const sessions = j.sessions ?? [];
        setUpcomingCount(sessions.length);
        setHasLiveNow(sessions.some(s => s.session_type === 'live'));
      })
      .catch(() => {});
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('fmp_sidebar_collapsed', String(next));
  }

  async function handleLogout() {
    await fetch('/api/training/logout', { method: 'POST' });
    clearTrainingSession();
    router.replace('/training');
  }

  // Determine active state from pathname if not explicitly set
  const currentNav = activeNav ?? (
    pathname.includes('/live-sessions') ? 'live-sessions' :
    pathname.includes('/certificates') ? 'certificates' : 'dashboard'
  );

  const sidebarW = sidebarCollapsed ? 56 : 240;

  function NavItem({ icon, label, active, href, onClick, badge, badgeColor, dot, dotColor, wrapLabel }: {
    icon: ReactNode; label: string; active?: boolean; href?: string; onClick?: () => void;
    badge?: string | number; badgeColor?: string; dot?: boolean; dotColor?: string;
    /** Allow label text to wrap to next line (for course names) */
    wrapLabel?: boolean;
  }) {
    const showBadge = badge != null && (typeof badge === 'string' || Number(badge) > 0);
    const content = (
      <>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
        {!sidebarCollapsed && (
          <span style={{
            fontSize: 12, fontWeight: active ? 700 : 600, flex: 1,
            ...(wrapLabel
              ? { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const, lineHeight: 1.3 }
              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
            ),
          }}>{label}</span>
        )}
        {dot && !sidebarCollapsed && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor ?? '#EF4444', flexShrink: 0, animation: 'pulse-dot 1.5s ease infinite' }} />}
        {showBadge && !sidebarCollapsed && (
          <span style={{ fontSize: 9, fontWeight: 800, background: badgeColor ?? '#3B82F6', color: '#fff', padding: '1px 6px', borderRadius: 8, flexShrink: 0 }}>{badge}</span>
        )}
      </>
    );
    const style: React.CSSProperties = {
      width: '100%', textAlign: 'left',
      background: active ? '#1B4F8A' : 'transparent',
      border: 'none',
      borderLeft: `3px solid ${active ? GREEN : 'transparent'}`,
      borderRadius: 6, padding: sidebarCollapsed ? '10px 0' : '8px 12px',
      cursor: 'pointer', display: 'flex', alignItems: wrapLabel && !sidebarCollapsed ? 'flex-start' : 'center',
      gap: 8, marginBottom: 2, transition: 'background 0.15s',
      color: active ? '#fff' : 'rgba(255,255,255,0.7)',
      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
      textDecoration: 'none', position: 'relative',
    };

    // Collapsed mode: badges/dots as absolute overlays
    const collapsedOverlays = sidebarCollapsed && (
      <>
        {dot && <span style={{ position: 'absolute', top: 6, right: 10, width: 7, height: 7, borderRadius: '50%', background: dotColor ?? '#EF4444', animation: 'pulse-dot 1.5s ease infinite' }} />}
        {showBadge && <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 8, fontWeight: 800, background: badgeColor ?? '#3B82F6', color: '#fff', padding: '1px 4px', borderRadius: 6, minWidth: 14, textAlign: 'center' }}>{badge}</span>}
      </>
    );

    if (href) {
      return (
        <Link href={href} onClick={() => setMobileSidebarOpen(false)} style={style} title={sidebarCollapsed ? label : undefined}>
          {content}{collapsedOverlays}
        </Link>
      );
    }
    return (
      <button onClick={() => { onClick?.(); setMobileSidebarOpen(false); }} style={style} title={sidebarCollapsed ? label : undefined}>
        {content}{collapsedOverlays}
      </button>
    );
  }

  function NavLabel({ text }: { text: string }) {
    if (sidebarCollapsed) return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 10px' }} />;
    return (
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '10px 12px 4px' }}>
        {text}
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
        <div style={{ background: NAVY, height: 56 }} />
        <div style={{ textAlign: 'center', padding: 80, color: '#9CA3AF' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>
      <style>{`
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .ts-hamburger { display: none !important; }
        .ts-mob-backdrop { display: none !important; }
        .ts-bottom-nav { display: none !important; }
        @media (max-width: 767px) {
          .ts-hamburger { display: flex !important; }
          .ts-sidebar {
            position: fixed !important;
            left: ${mobileSidebarOpen ? '0' : '-260px'} !important;
            top: 0 !important; bottom: 0 !important;
            z-index: 200 !important;
            width: 240px !important;
            transition: left 0.3s ease !important;
            overflow-y: auto !important;
          }
          .ts-mob-backdrop {
            display: ${mobileSidebarOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 199;
          }
          .ts-sidebar-toggle { display: none !important; }
          .ts-main { padding: 16px 16px 80px !important; }
          .ts-bottom-nav {
            display: flex !important;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: ${NAVY}; z-index: 180;
            border-top: 1px solid rgba(255,255,255,0.1);
            height: 56px; align-items: center; justify-content: space-around;
            box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
          }
        }
      `}</style>

      {/* Mobile backdrop */}
      <div className="ts-mob-backdrop" onClick={() => setMobileSidebarOpen(false)} />

      {/* ── TOP NAV ──────────────────────────────────────────────────────────── */}
      <div style={{ background: NAVY, padding: '0 20px', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 150, boxShadow: '0 2px 12px rgba(0,0,0,0.2)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="ts-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            &#9776;
          </button>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Financial Modeler Pro" style={{ height: parseInt(logoHeightPx) || 36, width: 'auto', objectFit: 'contain' }} />
            ) : (
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Financial Modeler Pro</div>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, background: 'rgba(46,170,74,0.15)', padding: '3px 8px', borderRadius: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Training Hub</span>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/training/dashboard"
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            <LayoutDashboard size={13} /> Dashboard
          </Link>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────────────── */}
      {headerOnly ? (
        <div style={{ flex: 1, minHeight: 'calc(100vh - 56px)' }}>{children}</div>
      ) : (
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
        <aside className="ts-sidebar" style={{
          width: sidebarW, flexShrink: 0,
          background: NAVY,
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 56,
          height: 'calc(100vh - 56px)',
          overflowY: 'auto', overflowX: 'hidden',
          transition: 'width 0.3s ease',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>
          {/* Mobile close */}
          <div className="ts-hamburger" style={{ padding: '12px 16px 0', justifyContent: 'flex-end' }}>
            <button onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 4 }}>&#10005;</button>
          </div>

          {/* Navigation */}
          <div style={{ padding: sidebarCollapsed ? '12px 4px' : '12px 8px', flex: 1 }}>
            {/* Dashboard */}
            <NavItem icon={<LayoutDashboard size={16} />} label="Dashboard" active={currentNav === 'dashboard'} href="/training/dashboard" />

            {/* MY COURSES */}
            <NavLabel text="My Courses" />
            <NavItem icon={<BookOpen size={16} />} label="3-Statement Financial Modeling" href="/training/dashboard?course=3sfm" wrapLabel />
            <NavItem icon={<Lock size={16} />} label="Business Valuation Modeling" href="/training/dashboard?course=bvm" wrapLabel
              badge="LOCKED" badgeColor="rgba(255,255,255,0.15)" />

            {/* TRAINING SESSIONS */}
            <NavLabel text="Training Sessions" />
            <NavItem icon={<Video size={16} />} label="Live Sessions" active={currentNav === 'live-sessions'}
              dot={hasLiveNow} dotColor="#EF4444"
              badge={upcomingCount > 0 ? upcomingCount : undefined} badgeColor="#3B82F6"
              onClick={() => {
                setSessionsExpanded(prev => !prev);
                if (!sessionsLoaded) {
                  fetch('/api/public/training-sessions?limit=30')
                    .then(r => r.json())
                    .then((d: { sessions?: Array<{ id: string; title: string; session_type: string; duration_minutes: number | null; scheduled_datetime: string }> }) => {
                      setSessionsList(d.sessions ?? []);
                      setSessionsLoaded(true);
                    })
                    .catch(() => {});
                }
              }}
            />
            {/* Accordion — session list */}
            {sessionsExpanded && !sidebarCollapsed && (
              <div style={{ padding: '0 8px 4px' }}>
                {!sessionsLoaded && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '6px 12px' }}>Loading...</div>}
                {sessionsLoaded && (() => {
                  const upcoming = sessionsList.filter(s => s.session_type === 'upcoming' || s.session_type === 'live')
                    .sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());
                  const recorded = sessionsList.filter(s => s.session_type === 'recorded')
                    .sort((a, b) => new Date(b.scheduled_datetime).getTime() - new Date(a.scheduled_datetime).getTime());
                  return (
                    <>
                      {upcoming.length > 0 && (
                        <>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', padding: '6px 12px 2px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Upcoming</div>
                          {upcoming.map(s => (
                            <Link key={s.id} href={`/training/live-sessions/${s.id}`} onClick={() => setMobileSidebarOpen(false)}
                              style={{ display: 'block', padding: '6px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.title}
                              {s.duration_minutes && <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{s.duration_minutes}m</span>}
                            </Link>
                          ))}
                        </>
                      )}
                      {recorded.length > 0 && (
                        <>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', padding: '6px 12px 2px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Recordings</div>
                          {recorded.map(s => (
                            <Link key={s.id} href={`/training/live-sessions/${s.id}`} onClick={() => setMobileSidebarOpen(false)}
                              style={{ display: 'block', padding: '6px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.title}
                              {s.duration_minutes && <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{s.duration_minutes}m</span>}
                            </Link>
                          ))}
                        </>
                      )}
                      {sessionsList.length === 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '6px 12px' }}>No sessions yet</div>}
                    </>
                  );
                })()}
              </div>
            )}

            {/* MY ACHIEVEMENTS */}
            <NavLabel text="My Achievements" />
            <NavItem icon={<Award size={16} />} label="Certificates" href="/training/dashboard" />
            <NavItem icon={<Medal size={16} />} label="Badges" href="/training/dashboard" />
            <NavItem icon={<FileText size={16} />} label="Transcripts" href="/training/dashboard" />

            {/* ACCOUNT */}
            <NavLabel text="Account" />
            <NavItem icon={<User size={16} />} label="Profile" href="/training/dashboard" />
            <NavItem icon={<Star size={16} />} label="Share Experience" href="/training/submit-testimonial" />
            {/* Follow Us */}
            {!sidebarCollapsed && (
              <div style={{ padding: '10px 12px 6px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>Follow Us</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <a href="https://www.linkedin.com/showcase/financialmodelerpro/" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, background: '#0077b5', color: '#fff', textDecoration: 'none' }}>
                    LinkedIn
                  </a>
                  <a href={`https://www.youtube.com/channel/${process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}?sub_confirmation=1`} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, background: '#FF0000', color: '#fff', textDecoration: 'none' }}>
                    YouTube
                  </a>
                </div>
              </div>
            )}

            <NavItem icon={<LogOut size={16} />} label="Sign Out" onClick={handleLogout} />
          </div>

          {/* Collapse toggle */}
          <button className="ts-sidebar-toggle" onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ margin: '8px auto 12px', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
        <main className="ts-main" style={{ flex: 1, minWidth: 0, padding: '28px 28px 64px', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
      )}

      {/* ── FOOTER + BOTTOM NAV (hidden in headerOnly mode) ──────────────── */}
      {!headerOnly && (<>
      <footer style={{ background: NAVY, color: 'rgba(255,255,255,0.5)', padding: '32px 24px 24px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Financial Modeler Pro</div>
            <div style={{ fontSize: 11 }}>&copy; {new Date().getFullYear()} Financial Modeler Pro. All rights reserved.</div>
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: 11, flexWrap: 'wrap' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Home</Link>
            <Link href="/training/dashboard" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Courses</Link>
            <Link href="/training/dashboard?tab=live-sessions" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Live Sessions</Link>
            <Link href="/privacy-policy" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Privacy</Link>
            <Link href="/confidentiality" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>Terms</Link>
          </div>
        </div>
      </footer>

      {/* ── Mobile Bottom Nav ──────────────────────────────────────────────── */}
      <div className="ts-bottom-nav">
        {[
          { icon: <LayoutDashboard size={18} />, label: 'Home', href: '/training/dashboard', active: currentNav === 'dashboard' },
          { icon: <BookOpen size={18} />, label: 'Courses', href: '/training/dashboard?course=3sfm', active: false },
          { icon: <Video size={18} />, label: 'Live', href: '/training/dashboard?tab=live-sessions', active: currentNav === 'live-sessions' },
          { icon: <Award size={18} />, label: 'Achieve', href: '/training/dashboard', active: false },
          { icon: <User size={18} />, label: 'Profile', href: '/training/dashboard', active: false },
        ].map(item => (
          <Link key={item.label} href={item.href}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: item.active ? GREEN : 'rgba(255,255,255,0.5)', textDecoration: 'none', padding: '6px 0', fontSize: 16 }}>
            {item.icon}
            <span style={{ fontSize: 9, fontWeight: 700 }}>{item.label}</span>
          </Link>
        ))}
      </div>
      </>)}
      <WelcomeModal storageKey="fmp_hub_welcomed" />
    </div>
  );
}
