'use client';

/**
 * The live course landing page layout: hero (banner, title, tagline, key
 * facts, big Register / Enrol, countdown), a side card that stays in view on
 * desktop and a fixed Register bar on phones, then the body sections in the
 * course's order (liveCourse/pageSections.ts). Presentational: the course page
 * (LiveCourseClient) passes the data and the pieces only it can build
 * (the action button, the curriculum cards, the student's own progress).
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Layers, Grid3x3, Banknote, Hotel, TrendingUp, Bot, Building2, Briefcase, Users, GraduationCap,
  FileSpreadsheet, Video, Monitor, Award, CheckCircle2, Calendar, Clock, Target, ShieldCheck, Star,
} from 'lucide-react';
import type { PageConfig, SectionKey, IconItem, IconName } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { countdownText, showEnrolledCount, visibleSections } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { courseEyebrow } from '@/src/hubs/training/lib/liveCourse/paths';
import { TimeZoneTable } from '@/src/hubs/training/components/sessions/TimeZoneTable';

const NAVY = '#1B4F8A';
const DARK = '#0D2E5A';
const GOLD = '#C9A84C';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';
const INK = '#2A3440';

const ICON_COMPONENTS: Record<IconName, typeof Layers> = {
  layers: Layers, grid: Grid3x3, banknote: Banknote, hotel: Hotel, 'trending-up': TrendingUp, bot: Bot,
  building: Building2, briefcase: Briefcase, users: Users, 'graduation-cap': GraduationCap,
  'file-spreadsheet': FileSpreadsheet, video: Video, monitor: Monitor, award: Award, 'check-circle': CheckCircle2,
  calendar: Calendar, clock: Clock, target: Target, 'shield-check': ShieldCheck, star: Star,
};

export interface LandingData {
  page: PageConfig;
  title: string;
  /** The course's short title (e.g. REFM), shown in the line above the title. */
  shortTitle: string;
  tagline: string;
  bannerUrl: string | null;
  bannerAlt: string;
  facts: string[];
  /** The next session not yet started (countdown + side card), or null once the course has run. */
  next: { no: number | null; startIso: string } | null;
  timeZones: string[] | null;
  enrolledCount: number;
  samples: { certificateUrl: string | null; badgeUrl: string | null };
  counts: { testimonials: number; sessions: number; instructors: number };
}

export function CourseLanding({
  d, action: actions, calendarHref, slots,
}: {
  d: LandingData;
  /** The Register / Enrol / Enrolled control, for dark (hero, call to action) and light (side card, bar) backgrounds. */
  action: { dark: ReactNode; light: ReactNode };
  /** "Add to calendar" for an enrolled student. */
  calendarHref: string | null;
  slots: Partial<Record<SectionKey | 'personal' | 'about', ReactNode>>;
}) {
  const S = d.page.sections;
  const body = visibleSections(d.page, d.counts);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const countdown = now != null && d.next && S.hero.countdown ? countdownText(d.next.startIso, now) : null;
  const showCount = S.sideCard.enabled && showEnrolledCount(d.enrolledCount, S.sideCard.enrolledThreshold);

  const hero = d.bannerUrl
    ? { backgroundImage: `linear-gradient(90deg, rgba(13,46,90,0.94) 0%, rgba(13,46,90,0.7) 55%, rgba(13,46,90,0.3) 100%), url(${d.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, ${DARK}, ${NAVY})` };

  const sideCard = S.sideCard.enabled && (
    <div data-testid="landing-side-card" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 14, padding: 20, boxShadow: '0 8px 24px rgba(13,46,90,0.08)' }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: DARK }}>Free</div>
      {d.next && (
        <div style={{ fontSize: 13.5, color: SLATE, margin: '6px 0 14px' }}>
          Next session{d.next.no != null ? ` (${d.next.no})` : ''}:<br /><strong style={{ color: INK }}>{formatSessionTime(d.next.startIso)}</strong>
        </div>
      )}
      <div className="lc-side-action">{actions.light}</div>
      {calendarHref && <a href={calendarHref} style={{ display: 'block', marginTop: 12, color: NAVY, fontWeight: 700, fontSize: 13.5 }}>📅 Add to calendar</a>}
      {showCount && <div data-testid="landing-enrolled-count" style={{ marginTop: 12, fontSize: 13, color: SLATE }}>👥 {d.enrolledCount} enrolled</div>}
      {d.next && <TimeZoneTable iso={d.next.startIso} zones={d.timeZones} collapsible />}
    </div>
  );

  const section = (key: SectionKey, inner: ReactNode, opts: { tint?: boolean; heading?: string } = {}) => (
    <section key={key} id={`lc-${key}`} data-testid={`landing-section-${key}`} style={{ padding: '30px 0', borderTop: `1px solid ${PALE}`, background: opts.tint ? 'transparent' : undefined }}>
      {opts.heading && <h2 style={{ fontSize: 'clamp(20px,2.6vw,26px)', fontWeight: 800, color: DARK, margin: '0 0 16px' }}>{opts.heading}</h2>}
      {inner}
    </section>
  );

  const iconGrid = (items: IconItem[], min = 240) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 14 }}>
      {items.map((it, i) => {
        const Icon = ICON_COMPONENTS[it.icon] ?? CheckCircle2;
        return (
          <div key={i} style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 12, padding: 16, display: 'flex', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#EEF3FA', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon size={20} color={NAVY} /></div>
            <div><div style={{ fontWeight: 800, color: DARK, fontSize: 15 }}>{it.title}</div><div style={{ fontSize: 14, color: INK, lineHeight: 1.5, marginTop: 2 }}>{it.text}</div></div>
          </div>
        );
      })}
    </div>
  );

  const render = (k: SectionKey): ReactNode => {
    switch (k) {
      case 'about': return slots.about ? section(k, slots.about) : null;
      case 'curriculum': return section(k, slots.curriculum, { heading: S.curriculum.heading });
      case 'skills': return section(k, iconGrid(S.skills.items), { heading: S.skills.heading });
      case 'whoFor': return section(k, iconGrid(S.whoFor.items, 220), { heading: S.whoFor.heading });
      case 'tools': return section(k, iconGrid(S.tools.items, 220), { heading: S.tools.heading });
      case 'certification': return section(k, (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
            {S.certification.steps.map((st, i) => (
              <div key={i} data-testid="landing-cert-step" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 12, padding: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 16, background: GOLD, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{i + 1}</div>
                <div style={{ fontWeight: 800, color: DARK, fontSize: 15, marginTop: 8 }}>{st.title}</div>
                <div style={{ fontSize: 14, color: INK, lineHeight: 1.5, marginTop: 4 }}>{st.text}</div>
              </div>
            ))}
          </div>
          {S.certification.showSamples && (d.samples.certificateUrl || d.samples.badgeUrl) && (
            <div data-testid="landing-cert-samples" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
              {d.samples.badgeUrl && <img src={d.samples.badgeUrl} alt="Sample course badge" style={{ width: 120, height: 120, objectFit: 'contain' }} />}
              {d.samples.certificateUrl && <a href={d.samples.certificateUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>View a sample certificate (PDF)</a>}
            </div>
          )}
        </>
      ), { heading: S.certification.heading });
      case 'instructor': return slots.instructor ? <section key={k} id="lc-instructor" data-testid="landing-section-instructor" style={{ margin: '30px 0', borderRadius: 14, overflow: 'hidden' }}>{slots.instructor}</section> : null;
      case 'testimonials': return slots.testimonials ? <section key={k} id="lc-testimonials" data-testid="landing-section-testimonials" style={{ margin: '30px 0' }}>{slots.testimonials}</section> : null;
      case 'faq': return section(k, (
        <div style={{ display: 'grid', gap: 8 }}>
          {S.faq.items.map((f, i) => (
            <details key={i} data-testid="landing-faq-item" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '12px 16px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800, color: DARK, fontSize: 15 }}>{f.q}</summary>
              <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.6, color: INK }}>{f.a}</p>
            </details>
          ))}
        </div>
      ), { heading: S.faq.heading });
      case 'cta': return (
        <section key={k} data-testid="landing-section-cta" style={{ margin: '30px 0 10px', background: `linear-gradient(135deg, ${DARK}, ${NAVY})`, color: '#fff', borderRadius: 14, padding: 'clamp(22px,4vw,36px)', textAlign: 'center' }}>
          <p style={{ fontSize: 'clamp(18px,2.4vw,24px)', fontWeight: 800, margin: '0 0 16px', lineHeight: 1.35 }}>{S.cta.text || `${d.title}. Free, live, with a certificate.`}</p>
          <div style={{ display: 'inline-block' }}>{actions.dark}</div>
        </section>
      );
      default: return null;
    }
  };

  return (
    <div data-testid="course-landing" style={{ color: INK, overflowX: 'hidden' }}>
      <style>{`
        .lc-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; align-items: start; }
        .lc-aside { position: sticky; top: 90px; }
        .lc-mobile-bar { display: none; }
        /* The course sidebar takes 280px beside this, so the side card stacks earlier. */
        @media (max-width: 1240px) {
          .lc-layout { grid-template-columns: minmax(0, 1fr); }
          .lc-aside { position: static; max-width: 520px; }
        }
        @media (max-width: 900px) {
          .lc-mobile-bar { display: flex; }
          .lc-page { padding-bottom: 84px; }
        }
      `}</style>

      {S.hero.enabled && (
        <div data-testid="landing-hero" role="img" aria-label={d.bannerAlt || d.title} style={{ ...hero, color: '#fff', borderRadius: 16, padding: 'clamp(26px,5vw,56px) clamp(20px,4vw,44px)', marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, fontWeight: 800 }} data-testid="landing-eyebrow">{courseEyebrow(d.shortTitle)}</div>
          <h1 style={{ fontSize: 'clamp(26px,4.4vw,40px)', fontWeight: 800, margin: '8px 0 8px', maxWidth: 720, lineHeight: 1.15 }}>{d.title}</h1>
          {d.tagline && <p style={{ margin: 0, opacity: 0.95, fontSize: 'clamp(15px,1.8vw,18px)', maxWidth: 680 }}>{d.tagline}</p>}
          {d.facts.length > 0 && (
            <div data-testid="landing-facts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {d.facts.map((f, i) => <span key={i} style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 20, padding: '5px 12px', fontSize: 13, fontWeight: 700 }}>{f}</span>)}
            </div>
          )}
          <div style={{ marginTop: 20 }}>{actions.dark}</div>
          {countdown && d.next && (
            <div data-testid="landing-countdown" style={{ marginTop: 14, fontSize: 14.5, fontWeight: 700, color: '#FDE68A' }}>
              ⏳ {d.next.no != null ? `Session ${d.next.no}` : 'The next session'} starts in {countdown}
            </div>
          )}
        </div>
      )}

      <div className="lc-page">
        <div className="lc-layout">
          <div style={{ minWidth: 0 }}>
            {slots.personal}
            {body.map(render)}
          </div>
          {sideCard && <aside className="lc-aside">{sideCard}</aside>}
        </div>
      </div>

      {S.sideCard.enabled && (
        <div className="lc-mobile-bar" data-testid="landing-mobile-bar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: '#fff', borderTop: `1px solid ${PALE}`, padding: '10px 16px', gap: 12, alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 -6px 18px rgba(13,46,90,0.08)' }}>
          <div style={{ fontSize: 13, color: SLATE, minWidth: 0 }}><strong style={{ color: DARK }}>Free</strong>{d.next ? ` · ${formatSessionTime(d.next.startIso)}` : ''}</div>
          <div style={{ flexShrink: 0 }}>{actions.light}</div>
        </div>
      )}
    </div>
  );
}
