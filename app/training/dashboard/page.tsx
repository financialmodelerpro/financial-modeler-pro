'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import {
  LayoutDashboard, BookOpen, Lock, Video, Award, Medal,
  FileText, User, LogOut, ChevronLeft, ChevronRight, ArrowLeft, Star,
  Flame, Zap, Target, Rocket, Trophy, Timer, Footprints, Sparkles,
  Eye, Download, X, PlayCircle,
} from 'lucide-react';
import { extractYouTubeId } from '@/src/shared/cms';
import { getTrainingSession, clearTrainingSession } from '@/src/hubs/training/lib/session/training-session';
import { useInactivityLogout } from '@/src/shared/hooks/useInactivityLogout';
import { COURSES } from '@/src/config/courses';
import { calculateCourseProgress } from '@/src/hubs/training/lib/progress/progressCalculator';
import {
  type LiveLinksMap,
  type CourseDescsMap,
  type SessionProgress,
  type ProgressData,
  type Certificate,
  getEnrolledCourses,
  buildProgressMap,
  allRegularSessionsPassed,
  Skeleton,
  CourseContent,
  CertificateImageCard,
  ShareModal,
  FeedbackModal,
  ProfileModal,
} from '@/src/hubs/training/components/dashboard';
import { ShareExperienceModal } from '@/src/shared/components/ShareExperienceModal';
import { LiveSessionsContent } from '@/src/hubs/training/components/dashboard/LiveSessionsContent';
import { LiveSessionsSection } from '@/src/hubs/training/components/dashboard/LiveSessionsSection';
import { formatShareDate } from '@/src/lib/training/shareTemplates';
import { DashboardTour } from '@/src/hubs/training/components/DashboardTour';

// ── Badge metadata ─────────────────────────────────────────────────────────────
type LucideIcon = typeof Flame;
interface BadgeMeta { Icon: LucideIcon; bg: string; fg: string; label: string; desc: string }
const BADGE_META: Record<string, BadgeMeta> = {
  first_step:    { Icon: Footprints, bg: '#DCFCE7', fg: '#16A34A', label: 'First Step',    desc: 'Passed your first session' },
  on_fire:       { Icon: Flame,      bg: '#FFF7ED', fg: '#EA580C', label: 'On Fire',       desc: 'Passed 3 sessions' },
  unstoppable:   { Icon: Zap,        bg: '#FEF9C3', fg: '#CA8A04', label: 'Unstoppable',   desc: '5-day streak' },
  halfway:       { Icon: Target,     bg: '#DBEAFE', fg: '#2563EB', label: 'Halfway',       desc: 'Passed 9 sessions' },
  almost_there:  { Icon: Rocket,     bg: '#F3E8FF', fg: '#9333EA', label: 'Almost There',  desc: 'Passed 15 sessions' },
  certified:     { Icon: Trophy,     bg: '#FEF3C7', fg: '#B45309', label: 'Certified',     desc: 'All sessions completed' },
  perfect_score: { Icon: Sparkles,   bg: '#D1FAE5', fg: '#059669', label: 'Perfect Score', desc: 'Scored 100% on a session' },
  speed_runner:  { Icon: Timer,      bg: '#CFFAFE', fg: '#0891B2', label: 'Speed Runner',  desc: 'Completed quickly' },
};

function BadgeIcon({ meta, size = 48, locked }: { meta: BadgeMeta; size?: number; locked?: boolean }) {
  const iconSize = Math.round(size * 0.5);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: locked ? '#F3F4F6' : meta.bg,
      filter: locked ? 'grayscale(1)' : undefined,
      opacity: locked ? 0.4 : 1,
      margin: '0 auto',
    }}>
      <meta.Icon size={iconSize} color={locked ? '#9CA3AF' : meta.fg} strokeWidth={2.2} />
    </div>
  );
}

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.693.625.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>
    </svg>
  );
}

// ── Live session type ──────────────────────────────────────────────────────────
interface LiveSession {
  id: string;
  title: string;
  description?: string;
  session_type: 'upcoming' | 'live' | 'recorded';
  scheduled_datetime?: string;
  timezone?: string;
  banner_url?: string;
  youtube_url?: string;
  live_url?: string;
  category?: string;
  instructor_name?: string;
  duration_minutes?: number;
  playlist?: { id: string; name: string } | null;
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export default function TrainingDashboardPage() {
  const router = useRouter();
  // Auto sign-out after 1 hour of inactivity
  useInactivityLogout({
    logoutUrl:   '/api/training/logout',
    redirectUrl: '/signin?reason=inactivity',
  });

  const [localSession, setLocalSession]           = useState<{ email: string; registrationId: string } | null>(null);
  const [loading, setLoading]                     = useState(true);
  const [refreshing, setRefreshing]               = useState(false);
  const [isFallback, setIsFallback]               = useState(false);
  const [progress, setProgress]                   = useState<ProgressData | null>(null);
  const [certificates, setCertificates]           = useState<Certificate[]>([]);
  const [activeCourse, setActiveCourse]           = useState('3sfm');
  const [liveLinks, setLiveLinks]                 = useState<LiveLinksMap>({});
  const [courseDescs, setCourseDescs]             = useState<CourseDescsMap>({});
  const [generating, setGenerating]               = useState(false);
  const [lastUpdated, setLastUpdated]             = useState<Date | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Onboarding tour - runs automatically on first-login; restartable via
  // the profile dropdown. `tourRun` gates the joyride UI; `tourReady`
  // avoids a visual flash before we know the student's completion state.
  const [tourRun,   setTourRun]   = useState(false);
  const [tourReady, setTourReady] = useState(false);
  // View mode: 'overview' (landing page), 'course' (course detail), or 'live-sessions'
  const [activeView, setActiveView]               = useState<'overview' | 'course' | 'live-sessions'>('overview');
  // share + testimonials
  // Structured event carrying everything the ShareModal forwarder needs to
  // render the correct template (text + hashtags + @-mentions).
  const [shareModal, setShareModal]               = useState<import('@/src/hubs/training/components/dashboard/CourseContent').DashboardShareEvent | null>(null);
  const [testimonialModal, setTestimonialModal]   = useState<'written' | 'video' | 'social' | null>(null);
  const [testimonialSubmitted, setTestimonialSubmitted] = useState(false);
  const [dashToast, setDashToast]                 = useState('');
  const [courseShareOpen, setCourseShareOpen]     = useState(false);
  const [courseShareCopied, setCourseShareCopied] = useState(false);
  // streak / gamification
  const [streak, setStreak]                       = useState(0);
  const [points, setPoints]                       = useState(0);
  const [badges, setBadges]                       = useState<{ badge_key: string; earned_at: string }[]>([]);
  const [newBadgeToast, setNewBadgeToast]         = useState('');
  const [badgePreview, setBadgePreview]           = useState<{ url: string; label: string } | null>(null);
  // notes
  const [notes, setNotes]                         = useState<Record<string, string>>({});
  // feedback
  const [feedbackGiven, setFeedbackGiven]         = useState<Set<string>>(new Set());
  const [feedbackModal, setFeedbackModal]         = useState<{ sessionKey: string; sessionTitle: string } | null>(null);
  // profile
  const [profileModal, setProfileModal]           = useState(false);
  const [profileDropdown, setProfileDropdown]     = useState(false);
  // timer bypass (server-side, from training_settings DB)
  const [timerBypassed, setTimerBypassed]         = useState(false);
  // certification watch history (tracks video watch status per session)
  const [certWatchCompleted, setCertWatchCompleted] = useState<Set<string>>(new Set());
  const [certWatchInProgress, setCertWatchInProgress] = useState<Set<string>>(new Set());
  const [watchPctMap, setWatchPctMap] = useState<Map<string, number>>(new Map());
  const [watchThreshold, setWatchThreshold] = useState<number>(70);
  const [studentProfile, setStudentProfile]       = useState<{ job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; display_name?: string; avatar_url?: string } | null>(null);
  const [avatarUploading, setAvatarUploading]     = useState(false);
  // avatarPreview replaced by cropImageSrc + react-easy-crop
  const sidebarFileInputRef                       = useRef<HTMLInputElement>(null);
  // Live sessions data
  const [upcomingSessions, setUpcomingSessions]   = useState<LiveSession[]>([]);
  const [hasLiveNow, setHasLiveNow]               = useState(false);
  const [upcomingCount, setUpcomingCount]          = useState(0);
  const [scrolledDown, setScrolledDown]           = useState(false);
  const [shareBannerDismissed, setShareBannerDismissed] = useState(true); // default true until checked
  const [dashLogoUrl, setDashLogoUrl] = useState<string | undefined>();
  const [dashLogoHeight, setDashLogoHeight] = useState('36');
  const [whatsappGroupUrl, setWhatsappGroupUrl] = useState('');
  const [walkthroughUrl, setWalkthroughUrl] = useState('');
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  // Fetch WhatsApp group URL + platform walkthrough video URL.
  useEffect(() => {
    fetch('/api/training/community-links')
      .then(r => r.json())
      .then((d: { whatsappGroupUrl?: string; platformWalkthroughUrl?: string }) => {
        if (d.whatsappGroupUrl) setWhatsappGroupUrl(d.whatsappGroupUrl);
        if (d.platformWalkthroughUrl) setWalkthroughUrl(d.platformWalkthroughUrl);
      })
      .catch(() => {});
  }, []);

  // Close walkthrough modal on Escape.
  useEffect(() => {
    if (!walkthroughOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWalkthroughOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walkthroughOpen]);

  // Fetch CMS logo for header
  useEffect(() => {
    fetch('/api/cms?section=header_settings&keys=logo_url,logo_height_px')
      .then(r => r.json())
      .then((d: { map?: Record<string, string> }) => {
        const url = d.map?.['header_settings__logo_url'];
        const h = d.map?.['header_settings__logo_height_px'];
        if (url) setDashLogoUrl(url);
        if (h) setDashLogoHeight(h);
      })
      .catch(() => {});
  }, []);

  // Restore sidebar state + share banner from localStorage (client-only)
  useEffect(() => {
    if (localStorage.getItem('fmp_sidebar_collapsed') === 'true') setSidebarCollapsed(true);
    setShareBannerDismissed(localStorage.getItem('fmp_share_banner_dismissed') === 'true');
  }, []);

  // Onboarding tour: check completion state on mount. Auto-start the
  // walkthrough only if the student hasn't seen it. Delayed until the
  // dashboard has data + its layout has painted - react-joyride measures
  // targets on step mount, so spotlight positions need the DOM settled.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/training/tour-status')
      .then(r => r.json())
      .then((j: { completed?: boolean; authenticated?: boolean }) => {
        if (cancelled) return;
        if (j.authenticated === false) { setTourReady(true); return; }
        setTourReady(true);
        if (j.completed === false) {
          // Wait one paint so data-tour targets exist when joyride starts.
          setTimeout(() => { if (!cancelled) setTourRun(true); }, 600);
        }
      })
      .catch(() => { if (!cancelled) setTourReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Handler used by the profile dropdown's Restart Tour entry. Resets the
  // DB flag + starts the joyride immediately so the student sees the tour
  // without a refresh.
  async function handleRestartTour() {
    setProfileDropdown(false);
    try {
      await fetch('/api/training/tour-status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ completed: false }),
      });
    } catch { /* non-fatal - tour still runs locally */ }
    setTourRun(true);
  }

  // Fires when the tour reaches a terminal state (finished / skipped / closed).
  // Persist completion + stop the run. We treat skipped == completed so we
  // don't re-harass the student who explicitly dismissed the tour.
  async function handleTourComplete(_reason: 'finished' | 'skipped' | 'closed') {
    setTourRun(false);
    try {
      await fetch('/api/training/tour-status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ completed: true }),
      });
    } catch { /* non-fatal - next visit will still try to start, API will 401 if not authed */ }
  }

  // Fetch upcoming-session counters for the sidebar + quick actions bar.
  // Per-card registration status is fetched by LiveSessionsSection.
  useEffect(() => {
    fetch('/api/training/live-sessions?type=upcoming')
      .then(r => r.json())
      .then((j: { sessions?: LiveSession[] }) => {
        const sessions = j.sessions ?? [];
        setUpcomingSessions(sessions.slice(0, 3));
        setUpcomingCount(sessions.length);
        setHasLiveNow(sessions.some(s => s.session_type === 'live'));
      })
      .catch(() => {});
  }, []);

  // Detect scroll for sticky breadcrumb
  useEffect(() => {
    const onScroll = () => setScrolledDown(window.scrollY > 100);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('fmp_sidebar_collapsed', String(next));
  }

  function navigateTo(view: 'overview' | 'course' | 'live-sessions', courseId?: string) {
    setActiveView(view);
    if (courseId) setActiveCourse(courseId);
    setMobileSidebarOpen(false);
    // Update URL without full navigation
    const url = view === 'overview' ? '/training/dashboard'
      : view === 'live-sessions' ? '/training/dashboard?tab=live-sessions'
      : `/training/dashboard?course=${courseId ?? activeCourse}`;
    window.history.replaceState({}, '', url);
  }

  const loadData = useCallback(async (
    sess: { email: string; registrationId: string },
    forceRefresh = false,
  ) => {
    // ── Show cached progress immediately, then refresh in background ─
    const CACHE_KEY = `fmp_progress_${sess.registrationId}`;
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    let cacheHit = false;
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { data: ProgressData; at: number };
          if (Date.now() - cached.at < CACHE_TTL) {
            setProgress(cached.data);
            setLoading(false);
            cacheHit = true; // Don't re-set loading=true - show cached data while fetching
          }
        }
      } catch { /* ignore */ }
    }

    if (forceRefresh) {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    }
    // Only show loading spinner if we don't have cached data to display
    if (forceRefresh) setRefreshing(true);
    else if (!cacheHit) setLoading(true);
    setIsFallback(false);
    try {
      const progressParams = new URLSearchParams({ email: sess.email, registrationId: sess.registrationId });
      if (forceRefresh) progressParams.set('refresh', '1');

      // Fetch all data in parallel - each with individual error handling so one failure doesn't block others
      const safeJson = async <T,>(p: Promise<Response>, fallback: T): Promise<T> => {
        try { const r = await p; return await r.json() as T; } catch { return fallback; }
      };

      const [json, detailsJson, notesJson, profileJson, certWatchJson, enforcementJson] = await Promise.all([
        safeJson(fetch(`/api/training/progress?${progressParams}`), { success: false } as { success: boolean; fallback?: boolean; data?: ProgressData }),
        safeJson(fetch('/api/training/course-details'), {} as { sessions?: { tabKey: string; sessionName: string; youtubeUrl: string; formUrl: string; videoDuration: number; isFinal: boolean; hasVideo: boolean }[]; courses?: CourseDescsMap; timerBypassed?: boolean }),
        safeJson(fetch(`/api/training/notes?registrationId=${encodeURIComponent(sess.registrationId)}`), {} as { notes?: { session_key: string; content: string }[] }),
        safeJson(fetch(`/api/training/profile?registrationId=${encodeURIComponent(sess.registrationId)}`), {} as { profile?: { job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; streak_days?: number; total_points?: number; display_name?: string; avatar_url?: string } | null }),
        safeJson(fetch(`/api/training/certification-watch?email=${encodeURIComponent(sess.email)}`), {} as { history?: { tab_key: string; status: string; watch_percentage?: number }[] }),
        safeJson(fetch('/api/training/watch-enforcement'), {} as { threshold?: number }),
      ]);

      // Apply notes
      const notesMap: Record<string, string> = {};
      for (const n of notesJson.notes ?? []) notesMap[n.session_key] = n.content;
      setNotes(notesMap);

      // Apply certification watch history
      const completed = new Set<string>();
      const inProg = new Set<string>();
      const pctMap = new Map<string, number>();
      for (const h of certWatchJson.history ?? []) {
        if (h.status === 'completed') completed.add(h.tab_key);
        else if (h.status === 'in_progress') inProg.add(h.tab_key);
        if (typeof h.watch_percentage === 'number') pctMap.set(h.tab_key, h.watch_percentage);
      }
      setCertWatchCompleted(completed);
      setCertWatchInProgress(inProg);
      setWatchPctMap(pctMap);

      // Apply watch enforcement threshold
      if (typeof enforcementJson.threshold === 'number') setWatchThreshold(enforcementJson.threshold);

      // Apply profile + streak/points
      if (profileJson.profile) {
        setStudentProfile(profileJson.profile);
        setStreak(profileJson.profile.streak_days ?? 0);
        setPoints(profileJson.profile.total_points ?? 0);
      }

      // Apply course-details
      const map: LiveLinksMap = {};
      for (const raw of detailsJson.sessions ?? []) {
        map[raw.tabKey] = { ...raw, videoDuration: raw.videoDuration ?? 0 };
      }
      setLiveLinks(map);
      if (detailsJson.courses) setCourseDescs(detailsJson.courses);
      setTimerBypassed(detailsJson.timerBypassed === true);

      // Apply progress (Supabase-merged data from server - instant and accurate)
      if (json.success && json.data) {
        setProgress(json.data);
        setLastUpdated(new Date());
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: json.data, at: Date.now() })); } catch { /* ignore */ }
        // Fire activity (streak/badges) - fire-and-forget
        const sessionsPassed = json.data.sessions.filter(s => s.passed).length;
        const hasPerfect = json.data.sessions.some(s => s.passed && s.score === 100);
        fetch('/api/training/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: sess.registrationId, sessionsPassed, hasPerfect }),
        }).then(r => r.json()).then((act: { ok?: boolean; streak?: number; points?: number; badges?: { badge_key: string; earned_at: string }[]; newBadges?: string[] }) => {
          if (act.ok) {
            setStreak(act.streak ?? 0);
            setPoints(act.points ?? 0);
            setBadges(act.badges ?? []);
            if (act.newBadges && act.newBadges.length > 0) {
              setNewBadgeToast(`New badge earned: ${act.newBadges[0].replace(/_/g, ' ')}`);
              setTimeout(() => setNewBadgeToast(''), 4000);
            }
          }
        }).catch(() => {});
        if (json.fallback) setIsFallback(true);
        // Always fetch certificates - the progress endpoint's
        // `certificateIssued` flag is sourced from Apps Script, so
        // force-issued certs (which only land in Supabase) would never
        // flip that flag and the card never rendered. The certificate API
        // unions both sources and returns an empty array when there's
        // nothing to show, which is cheap and correct.
        const certRes  = await fetch(`/api/training/certificate?email=${encodeURIComponent(sess.email)}`);
        const certJson = await certRes.json() as { success: boolean; data?: Certificate[] };
        if (certJson.success && certJson.data) setCertificates(certJson.data);
      } else {
        setProgress({ student: { name: sess.registrationId, email: sess.email, registrationId: sess.registrationId, course: '3sfm', registeredAt: '' }, sessions: [], finalPassed: false, certificateIssued: false });
        setIsFallback(true);
      }
    } catch {
      setProgress({ student: { name: sess.registrationId, email: sess.email, registrationId: sess.registrationId, course: '3sfm', registeredAt: '' }, sessions: [], finalPassed: false, certificateIssued: false });
      setIsFallback(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/signin'); return; }
    setLocalSession(sess);

    // Enrollment is now automatic: every new student gets 3SFM on email
    // confirmation (in /api/training/confirm-email), and BVM gets added
    // automatically when they pass the 3SFM final in /api/training/submit-assessment.
    // No enroll screen; dashboard renders whichever courses the student
    // has enrollments for via getEnrolledCourses(progress.student.course).

    const params = new URLSearchParams(window.location.search);
    const needsRefresh = params.get('refresh') === '1';
    if (needsRefresh) {
      window.history.replaceState({}, '', '/training/dashboard');
      try {
        const raw = sessionStorage.getItem('fmp_last_submit');
        if (raw) {
          sessionStorage.removeItem('fmp_last_submit');
          const submitted = JSON.parse(raw) as { tabKey: string; score: number; passed: boolean; attempts: number };
          const sep = submitted.tabKey.indexOf('_');
          const sessionId = sep >= 0 ? submitted.tabKey.slice(sep + 1) : submitted.tabKey;
          const cacheKey = `fmp_progress_${sess.registrationId}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as { data: ProgressData; at: number };
            const existing = parsed.data.sessions.find(s => s.sessionId === sessionId);
            if (existing) {
              existing.score = submitted.score;
              existing.passed = submitted.passed;
              existing.attempts = submitted.attempts;
            } else {
              parsed.data.sessions.push({ sessionId, score: submitted.score, passed: submitted.passed, attempts: submitted.attempts, completedAt: null });
            }
            parsed.at = Date.now();
            localStorage.setItem(cacheKey, JSON.stringify(parsed));
            setProgress(parsed.data);
          }
        }
      } catch { /* ignore */ }
    }
    // If ?tab=live-sessions, go to live sessions view
    const tabParam = params.get('tab');
    if (tabParam === 'live-sessions') {
      setActiveView('live-sessions');
    }
    // If ?course= is set, go directly to course view
    const courseParam = params.get('course');
    if (courseParam && ['3sfm', 'bvm'].includes(courseParam)) {
      setActiveCourse(courseParam);
      setActiveView('course');
    }
    loadData(sess, needsRefresh);
    try {
      if (localStorage.getItem(`fmp_test_${sess.registrationId}`) === 'true') {
        setTestimonialSubmitted(true);
      }
    } catch { /* ignore */ }
  }, [router, loadData]);

  async function downloadTranscript(courseId: string) {
    if (!localSession || !progress) return;
    setGenerating(true);
    try {
      const courseCode = (COURSES[courseId]?.shortTitle ?? courseId).toUpperCase();
      const regParts  = localSession.registrationId.split('-');
      const certStyleId = regParts.length >= 3 ? `FMP-${courseCode}-${regParts[1]}-${regParts[2]}` : `FMP-${courseCode}-${localSession.registrationId}`;
      const params = new URLSearchParams({ regId: localSession.registrationId, email: localSession.email, course: courseId });
      const res = await fetch(`/api/training/transcript?${params}`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `FMP-Transcript-${certStyleId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setDashToast('Could not generate transcript. Please try again.');
      setTimeout(() => setDashToast(''), 4000);
    } finally {
      setGenerating(false);
    }
  }

  // ── Avatar crop state ─────────────────────────────────────────────────────
  const [cropImageSrc, setCropImageSrc]   = useState<string | null>(null);
  const [crop, setCrop]                   = useState({ x: 0, y: 0 });
  const [zoom, setZoom]                   = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  function handleSidebarPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setDashToast('File too large - maximum size is 2 MB.');
      setTimeout(() => setDashToast(''), 4000);
      if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
      return;
    }
    const src = URL.createObjectURL(file);
    setCropImageSrc(src);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }

  function onCropComplete(_: Area, croppedPx: Area) {
    setCroppedAreaPixels(croppedPx);
  }

  function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Do NOT set crossOrigin on blob: URLs - causes CORS failure in some browsers
      if (!imageSrc.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable')); return; }
        ctx.drawImage(img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, 200, 200);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Crop failed'));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imageSrc;
    });
  }

  async function confirmAvatarUpload() {
    if (!cropImageSrc || !croppedAreaPixels || !localSession) return;
    setAvatarUploading(true);
    const src = cropImageSrc;
    const cropArea = croppedAreaPixels;
    setCropImageSrc(null);
    if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
    try {
      const blob = await getCroppedBlob(src, cropArea);
      URL.revokeObjectURL(src);
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      fd.append('regId', localSession.registrationId);
      const res = await fetch('/api/training/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      const busted = `${data.url}?v=${Date.now()}`;
      await fetch('/api/training/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: localSession.registrationId, avatarUrl: busted }),
      });
      setStudentProfile(prev => prev ? { ...prev, avatar_url: busted } : { avatar_url: busted });
      setDashToast('Profile photo updated');
      setTimeout(() => setDashToast(''), 3000);
    } catch {
      URL.revokeObjectURL(src);
      setDashToast('Upload failed - please try again.');
      setTimeout(() => setDashToast(''), 4000);
    } finally {
      setAvatarUploading(false);
    }
  }

  function cancelAvatarPreview() {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
    setCropImageSrc(null);
    if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
  }

  async function handleLogout() {
    await fetch('/api/training/logout', { method: 'POST' });
    clearTrainingSession();
    router.replace('/training');
  }

  async function saveNote(sessionKey: string, content: string) {
    if (!localSession) return;
    setNotes(prev => ({ ...prev, [sessionKey]: content }));
    await fetch('/api/training/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: localSession.registrationId, sessionKey, content }),
    });
  }

  async function saveFeedback(sessionKey: string, rating: number, comment: string) {
    if (!localSession) return;
    setFeedbackGiven(prev => new Set([...prev, sessionKey]));
    await fetch('/api/training/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: localSession.registrationId, sessionKey, rating, comment }),
    });
  }

  if (!localSession && !loading) return null;

  const enrolledCourses = progress ? getEnrolledCourses(progress.student.course) : [];
  const progressMap     = progress ? buildProgressMap(progress.sessions) : new Map<string, SessionProgress>();

  // Canonical display order for cert cards + the cert-badges grid.
  // student_certificates.course_code is the authoritative short code
  // ('3SFM', 'BVM'); anything else falls to the end so future courses
  // still render but don't jump ahead of 3SFM / BVM until they're
  // explicitly ranked. Falls back to the free-form `course` string
  // when courseCode isn't populated (legacy rows).
  const COURSE_DISPLAY_ORDER: Record<string, number> = { '3SFM': 0, 'BVM': 1 };
  const sortedCertificates = [...certificates].sort((a, b) => {
    const codeA = (a.courseCode ?? a.course ?? '').toUpperCase();
    const codeB = (b.courseCode ?? b.course ?? '').toUpperCase();
    const rankA = COURSE_DISPLAY_ORDER[codeA] ?? 99;
    const rankB = COURSE_DISPLAY_ORDER[codeB] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return codeA.localeCompare(codeB);
  });

  // BVM unlock: all 17 3SFM sessions + S18 final must be passed
  const sfmFinalSession = COURSES['3sfm']?.sessions.find(s => s.isFinal);
  const bvmUnlocked     = allRegularSessionsPassed('3sfm', progressMap) &&
    (sfmFinalSession ? progressMap.get(sfmFinalSession.id)?.passed === true : false);

  // 3SFM stats (for BVM locked state) - includes final exam
  const sfmRegular    = COURSES['3sfm']?.sessions ?? [];
  const sfmPassedCount = sfmRegular.filter(s => progressMap.get(s.id)?.passed).length;

  // Student avatar initials
  const studentName = studentProfile?.display_name || progress?.student.name || '';
  const initials = studentName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';
  const avatarUrl = studentProfile?.avatar_url || '';

  // Overall progress across enrolled courses. Session count stays unweighted
  // for the "X of Y sessions completed" copy. The progress BAR percentage uses
  // question-weighted totals so it lines up with the per-course pct shown on
  // each course tile (e.g. 15 of 18 passed → 68%, not 83%).
  const totalSessions = enrolledCourses.reduce((s, cId) => s + (COURSES[cId]?.sessions.length ?? 0), 0);
  const totalPassed   = enrolledCourses.reduce((s, cId) => {
    const c = COURSES[cId]; if (!c) return s;
    return s + c.sessions.filter(x => progressMap.get(x.id)?.passed).length;
  }, 0);
  const overallWeighted = enrolledCourses.reduce((acc, cId) => {
    const c = COURSES[cId]; if (!c) return acc;
    const wp = calculateCourseProgress(c, progressMap);
    return { earned: acc.earned + wp.earned, total: acc.total + wp.total };
  }, { earned: 0, total: 0 });
  const overallPct = overallWeighted.total > 0
    ? Math.round((overallWeighted.earned / overallWeighted.total) * 100)
    : 0;

  const isEnrolledInBvm = enrolledCourses.includes('bvm');

  // BVM access is gated on having a BVM enrollment row, not on the derived
  // 3SFM-final-passed signal. The two are aligned in practice (enrollment
  // auto-created on 3SFM Final pass in /api/training/submit-assessment) but
  // using the enrollment check directly means admin backfills + manual
  // overrides flip the gate instantly without round-tripping through
  // assessment state. Also catches Ahmad-style students whose pre-migration
  // 3SFM history isn't in Supabase: they have the BVM enrollment row from
  // migration 134, so BVM shows unlocked even though bvmUnlocked would be
  // false for them.
  const showLockedBvm = activeCourse === 'bvm' && !isEnrolledInBvm;
  // If the active course is 3SFM: show 3SFM. If active is BVM: always show
  // BVM (locked view if they aren't enrolled). Prevents the previous
  // fall-through that forced locked BVM-clickers back to 3SFM.
  const displayCourse = activeCourse === 'bvm' ? 'bvm' : '3sfm';

  const sidebarW = sidebarCollapsed ? 56 : 240;

  // Find next incomplete assessment for quick action
  const nextAssessment = (() => {
    for (const cId of enrolledCourses) {
      if (cId === 'bvm' && !bvmUnlocked) continue;
      const c = COURSES[cId];
      if (!c) continue;
      for (const s of c.sessions) {
        const prog = progressMap.get(s.id);
        if (!prog?.passed && (!prog || prog.attempts < s.maxAttempts)) {
          return { courseId: cId, session: s, tabKey: `${c.shortTitle}_${s.id}` };
        }
      }
    }
    return null;
  })();

  // Format date for live session banner
  function formatSessionDate(dt?: string, tz?: string) {
    if (!dt) return '';
    try {
      const d = new Date(dt);
      const formatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${formatted} at ${time}${tz ? ` (${tz})` : ''}`;
    } catch { return dt; }
  }

  function formatLocalTime(dt?: string) {
    if (!dt) return '';
    try {
      const d = new Date(dt);
      return `Your local time: ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } catch { return ''; }
  }

  // Per-course stats helper. `pct` is question-weighted (regular = 10 pts,
  // final exam = ~50 pts) so the overview view reflects actual knowledge
  // coverage rather than number of boxes ticked.
  function getCourseStats(courseId: string) {
    const c = COURSES[courseId];
    if (!c) return { total: 0, passed: 0, pct: 0, avgScore: 0, bestScore: 0, bestSession: '' };
    const all = c.sessions;
    const scores = all.map(s => progressMap.get(s.id)?.score ?? 0).filter(sc => sc > 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    let bestScore = 0;
    let bestSession = '';
    for (const s of all) {
      const sc = progressMap.get(s.id)?.score ?? 0;
      if (sc > bestScore) { bestScore = sc; bestSession = s.id; }
    }
    const wp = calculateCourseProgress(c, progressMap);
    return { total: wp.totalCount, passed: wp.passedCount, pct: wp.percentage, avgScore, bestScore, bestSession };
  }

  // ── Sidebar nav item helper ────────────────────────────────────────────────
  function SidebarItem({ icon, label, active, onClick, badge, badgeColor, dot, dotColor, tooltip, wrapLabel }: {
    icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
    badge?: string | number; badgeColor?: string; dot?: boolean; dotColor?: string; tooltip?: string;
    /** Allow label text to wrap to next line (for course names) */
    wrapLabel?: boolean;
  }) {
    const showBadge = badge != null && (typeof badge === 'string' || Number(badge) > 0);
    if (sidebarCollapsed) {
      return (
        <button onClick={onClick} title={tooltip ?? label}
          style={{ width: '100%', background: active ? '#1B4F8A' : 'transparent', border: 'none', borderLeft: `3px solid ${active ? '#2EAA4A' : 'transparent'}`, borderRadius: 6, padding: '10px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2, position: 'relative', color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>
          {icon}
          {dot && <span style={{ position: 'absolute', top: 6, right: 10, width: 7, height: 7, borderRadius: '50%', background: dotColor ?? '#EF4444', animation: 'pulse-dot 1.5s ease infinite' }} />}
          {showBadge && (
            <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 8, fontWeight: 800, background: badgeColor ?? '#3B82F6', color: '#fff', padding: '1px 4px', borderRadius: 6, minWidth: 14, textAlign: 'center' }}>{badge}</span>
          )}
        </button>
      );
    }
    return (
      <button onClick={onClick}
        style={{ width: '100%', textAlign: 'left', background: active ? '#1B4F8A' : 'transparent', border: 'none', borderLeft: `3px solid ${active ? '#2EAA4A' : 'transparent'}`, borderRadius: 6, padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: wrapLabel ? 'flex-start' : 'center', gap: 8, marginBottom: 2, transition: 'background 0.15s', color: active ? '#fff' : 'rgba(255,255,255,0.7)', position: 'relative' }}>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{
          fontSize: 12, fontWeight: active ? 700 : 600, flex: 1,
          ...(wrapLabel
            ? { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const, lineHeight: 1.3 }
            : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
          ),
        }}>{label}</span>
        {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor ?? '#EF4444', flexShrink: 0, animation: 'pulse-dot 1.5s ease infinite' }} />}
        {showBadge && (
          <span style={{ fontSize: 9, fontWeight: 800, background: badgeColor ?? '#3B82F6', color: '#fff', padding: '1px 6px', borderRadius: 8, flexShrink: 0 }}>{badge}</span>
        )}
      </button>
    );
  }

  // ── Sidebar section label ──────────────────────────────────────────────────
  function SidebarLabel({ text }: { text: string }) {
    if (sidebarCollapsed) return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 10px' }} />;
    return (
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '10px 12px 4px' }}>
        {text}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>

      {/* ── Global styles ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .dash-hamburger { display: none !important; }
        .dash-mob-backdrop { display: none !important; }
        .dash-bottom-nav { display: none !important; }
        .sidebar-avatar-btn .avatar-hover-overlay { opacity: 0; }
        .sidebar-avatar-btn:hover .avatar-hover-overlay { opacity: 1; }
        @media (max-width: 767px) {
          .dash-hamburger { display: flex !important; }
          .dash-topnav { padding: 0 16px !important; }
          .dash-sidebar {
            position: fixed !important;
            left: ${mobileSidebarOpen ? '0' : '-260px'} !important;
            top: 0 !important; bottom: 0 !important;
            z-index: 200 !important;
            width: 240px !important;
            transition: left 0.3s ease !important;
            overflow-y: auto !important;
          }
          .dash-mob-backdrop {
            display: ${mobileSidebarOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 199;
          }
          .dash-sidebar-toggle { display: none !important; }
          .dash-main { padding: 16px 16px 80px !important; }
          .dash-stats-grid { grid-template-columns: 1fr 1fr !important; }
          .dash-courses-grid { grid-template-columns: 1fr !important; }
          .dash-quick-actions { grid-template-columns: 1fr 1fr !important; }
          .dash-sessions-preview { display: flex !important; overflow-x: auto !important; gap: 12px !important; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
          .dash-sessions-preview > * { min-width: 260px !important; max-width: 300px !important; flex-shrink: 0 !important; scroll-snap-align: start; }
          .dash-badges-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .dash-sticky-breadcrumb { left: 0 !important; }
          .dash-bottom-nav {
            display: flex !important;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: #0D2E5A; z-index: 180;
            border-top: 1px solid rgba(255,255,255,0.1);
            height: 56px; align-items: center; justify-content: space-around;
            box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
          }
        }
      `}</style>

      {/* Mobile backdrop */}
      <div className="dash-mob-backdrop" onClick={() => setMobileSidebarOpen(false)} />

      {/* ── TOP NAV ──────────────────────────────────────────────────────────── */}
      <div className="dash-topnav" style={{ background: 'rgba(13,46,90,0.97)', backdropFilter: 'blur(12px)', padding: '0 40px', minHeight: 64, boxSizing: 'border-box' as const, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 150, borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="dash-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            &#9776;
          </button>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            {dashLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dashLogoUrl} alt="Financial Modeler Pro" style={{ height: parseInt(dashLogoHeight) || 36, width: 'auto', objectFit: 'contain' }} />
            ) : (
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Financial Modeler Pro</div>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, color: '#2EAA4A', background: 'rgba(46,170,74,0.15)', padding: '3px 8px', borderRadius: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Training Hub</span>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => localSession && loadData(localSession, true)}
            disabled={loading || refreshing}
            title="Refresh progress"
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: refreshing ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: loading || refreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>&#8635;</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {/* Profile avatar dropdown */}
          <div style={{ position: 'relative' }} data-tour="help-menu">
            <button
              onClick={() => setProfileDropdown(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: '#fff' }}
            >
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarUrl ? `url(${avatarUrl}) center/cover, #2EAA4A` : '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
                {!avatarUrl && initials}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {studentName || localSession?.registrationId || 'Student'}
              </span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>&#9662;</span>
            </button>
            {profileDropdown && (
              <div
                style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.18)', minWidth: 180, zIndex: 300, overflow: 'hidden', border: '1px solid #E5E7EB' }}
                onMouseLeave={() => setProfileDropdown(false)}
              >
                <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{studentName || 'Student'}</div>
                </div>
                <button onClick={() => { setProfileModal(true); setProfileDropdown(false); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: '#374151', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}>
                  <User size={14} /> Edit Profile
                </button>
                <button onClick={handleRestartTour}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: '#374151', cursor: 'pointer', fontWeight: 600, textAlign: 'left', borderTop: '1px solid #F3F4F6' }}>
                  <Sparkles size={14} /> Restart Tour
                </button>
                <button onClick={() => { setProfileDropdown(false); handleLogout(); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: '#DC2626', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}>
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
        <aside className="dash-sidebar" style={{
          width: sidebarW, flexShrink: 0,
          background: '#0D2E5A',
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 64,
          height: 'calc(100vh - 64px)',
          overflowY: 'auto', overflowX: 'hidden',
          transition: 'width 0.3s ease',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>

          {/* Mobile close button */}
          <div className="dash-hamburger" style={{ padding: '12px 16px 0', justifyContent: 'flex-end' }}>
            <button onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 4 }}>&#10005;</button>
          </div>

          {/* Student Info */}
          <div style={{ padding: sidebarCollapsed ? '16px 8px' : '16px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: sidebarCollapsed ? 'center' : 'flex-start' }}>
                <Skeleton w={40} h={40} radius={20} />
                {!sidebarCollapsed && <><Skeleton w={120} h={13} /><Skeleton w={80} h={11} /></>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: sidebarCollapsed ? 0 : 10 }}>
                  <div
                    title="Change profile photo"
                    className="sidebar-avatar-btn"
                    onClick={() => sidebarFileInputRef.current?.click()}
                    style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'visible', cursor: 'pointer' }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: avatarUrl && !avatarUploading ? `url(${avatarUrl}) center/cover, #2EAA4A` : '#2EAA4A', fontSize: 14, fontWeight: 800, color: '#fff', position: 'relative' }}>
                      {avatarUploading ? (
                        <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      ) : !avatarUrl ? initials : null}
                      {!avatarUploading && (
                        <div className="avatar-hover-overlay" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </div>
                      )}
                    </div>
                    {!avatarUploading && (
                      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: '#1d4ed8', border: '1.5px solid #0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      </div>
                    )}
                    <input ref={sidebarFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSidebarPhotoSelect} />
                  </div>
                  {!sidebarCollapsed && (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {studentName || 'Student'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginTop: 1 }}>
                        {progress?.student.registrationId}
                      </div>
                    </div>
                  )}
                </div>
                {!sidebarCollapsed && (
                  <div data-tour="overall-progress">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Overall Progress</span>
                      <span style={{ fontSize: 10, color: '#2EAA4A', fontWeight: 700 }}>{totalPassed}/{totalSessions}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: '#2EAA4A', width: `${totalSessions > 0 ? (totalPassed / totalSessions) * 100 : 0}%`, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Navigation */}
          <div style={{ padding: sidebarCollapsed ? '8px 4px' : '8px 8px', flex: 1 }}>

            {/* Dashboard */}
            <SidebarItem icon={<LayoutDashboard size={16} />} label="Dashboard" active={activeView === 'overview'} onClick={() => navigateTo('overview')} />

            {/* MY COURSES - always list both; BVM is locked until the student
                has a BVM enrollment row (auto-created on 3SFM Final pass). */}
            <SidebarLabel text="My Courses" />
            {(['3sfm', 'bvm'] as const).map(cId => {
              const c = COURSES[cId];
              if (!c) return null;
              const isEnrolled = enrolledCourses.includes(cId);
              const cStats = isEnrolled
                ? getCourseStats(cId)
                : { passed: 0, total: c.sessions.length, pct: 0, avgScore: 0, bestScore: 0, bestSession: null as string | null };
              const isActive = activeView === 'course' && activeCourse === cId;
              const isLocked = cId === 'bvm' && !isEnrolled;

              return (
                <SidebarItem
                  key={cId}
                  icon={isLocked ? <Lock size={16} /> : <BookOpen size={16} />}
                  label={c.title}
                  active={isActive}
                  onClick={() => navigateTo('course', cId)}
                  badge={isLocked ? 'LOCKED' : `${cStats.passed}/${cStats.total}`}
                  badgeColor={isLocked ? 'rgba(255,255,255,0.15)' : cStats.pct === 100 ? '#C9A84C' : '#2EAA4A'}
                  tooltip={isLocked ? `${c.title} - complete the 3SFM Final Exam to unlock` : `${c.title}: ${cStats.passed}/${cStats.total} sessions`}
                  wrapLabel
                />
              );
            })}

            {/* TRAINING SESSIONS */}
            <SidebarLabel text="Live Sessions" />
            <div data-tour="live-sessions-nav">
              <SidebarItem
                icon={<Video size={16} />}
                label="Live Sessions"
                active={activeView === 'live-sessions'}
                onClick={() => { setMobileSidebarOpen(false); navigateTo('live-sessions'); }}
                dot={hasLiveNow}
                dotColor="#EF4444"
                badge={upcomingCount > 0 ? upcomingCount : undefined}
                badgeColor="#3B82F6"
                tooltip={hasLiveNow ? 'LIVE NOW' : upcomingCount > 0 ? `${upcomingCount} upcoming` : 'Live Sessions'}
              />
            </div>

            {/* MY ACHIEVEMENTS */}
            <SidebarLabel text="My Achievements" />
            <SidebarItem icon={<Award size={16} />} label="Certificates" active={false}
              onClick={() => { if (activeView !== 'overview') navigateTo('overview'); setTimeout(() => document.getElementById('dash-achievements')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
              badge={certificates.length > 0 ? certificates.length : undefined} badgeColor="#C9A84C" />
            <SidebarItem icon={<Medal size={16} />} label="Badges" active={false}
              onClick={() => { if (activeView !== 'overview') navigateTo('overview'); setTimeout(() => document.getElementById('dash-badges')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
              badge={badges.length > 0 ? badges.length : undefined} badgeColor="#F59E0B" />

            {/* ACCOUNT */}
            <SidebarLabel text="Account" />
            <SidebarItem icon={<User size={16} />} label="Profile" onClick={() => { setProfileModal(true); setMobileSidebarOpen(false); }} />
            {totalPassed >= 1 && !testimonialSubmitted && (
              <SidebarItem icon={<Star size={16} />} label="Share Experience" onClick={() => { setTestimonialModal('written'); setMobileSidebarOpen(false); }} />
            )}
            <SidebarItem icon={<LogOut size={16} />} label="Sign Out" onClick={handleLogout} />

            {/* Follow Us */}
            {!sidebarCollapsed && (
              <div style={{ padding: '12px 12px 4px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Follow Us
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <a href="https://www.linkedin.com/showcase/financialmodelerpro/" target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#0077b5', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                    💼 Follow on LinkedIn
                  </a>
                  <a href={`https://www.youtube.com/channel/${process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}?sub_confirmation=1`} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#FF0000', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                    ▶ Subscribe on YouTube
                  </a>
                  {whatsappGroupUrl && (
                    <a href={whatsappGroupUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#25D366', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                      <WhatsAppIcon size={14} /> Join WhatsApp Group
                    </a>
                  )}
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8 }}>
                <a href="https://www.linkedin.com/showcase/financialmodelerpro/" target="_blank" rel="noopener noreferrer" title="Follow on LinkedIn"
                  style={{ width: 28, height: 28, borderRadius: 6, background: '#0077b5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                  in
                </a>
                <a href={`https://www.youtube.com/channel/${process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}?sub_confirmation=1`} target="_blank" rel="noopener noreferrer" title="Subscribe on YouTube"
                  style={{ width: 28, height: 28, borderRadius: 6, background: '#FF0000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, textDecoration: 'none' }}>
                  ▶
                </a>
                {whatsappGroupUrl && (
                  <a href={whatsappGroupUrl} target="_blank" rel="noopener noreferrer" title="Join WhatsApp Group"
                    style={{ width: 28, height: 28, borderRadius: 6, background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                    <WhatsAppIcon size={14} />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          <button className="dash-sidebar-toggle" onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ margin: '8px auto 12px', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {sidebarCollapsed ? '\u203A' : '\u2039'}
          </button>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
        <main className="dash-main" style={{ flex: 1, minWidth: 0, padding: '28px 28px 64px', overflowY: 'auto' }}>

          {/* Share banner (dismissable) */}
          {!loading && totalPassed >= 1 && !testimonialSubmitted && !shareBannerDismissed && (
            <div style={{ background: 'linear-gradient(90deg, #FFFBF0, #FEF3C7)', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#92400E', fontWeight: 600 }}>
                Enjoying your progress? Share with your network!
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setCourseShareOpen(true)}
                  style={{ padding: '5px 14px', borderRadius: 6, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 11, border: 'none', cursor: 'pointer' }}>🎉 Share</button>
                <button onClick={() => { setShareBannerDismissed(true); localStorage.setItem('fmp_share_banner_dismissed', 'true'); }}
                  style={{ background: 'none', border: 'none', color: '#92400E', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>&times;</button>
              </div>
            </div>
          )}

          {/* Fallback banner */}
          {!loading && isFallback && progress && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#92400E' }}>
                Could not load latest progress - showing your course structure. Your data will appear after the next sync.
              </span>
              <button onClick={() => localSession && loadData(localSession)}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div>
              <div style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', marginBottom: 20, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Skeleton w="55%" h={26} />
                <Skeleton w="40%" h={16} />
                <Skeleton w="100%" h={8} radius={4} />
              </div>
              <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton w={28} h={28} radius={6} />
                    <Skeleton w="60%" h={22} />
                    <Skeleton w="80%" h={11} />
                  </div>
                ))}
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '14px 18px', marginBottom: 8, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <Skeleton w="50%" h={14} />
                    <Skeleton w={80} h={22} radius={20} />
                  </div>
                  <Skeleton w="30%" h={12} />
                </div>
              ))}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════ */}
          {/* OVERVIEW LANDING PAGE                                               */}
          {/* ════════════════════════════════════════════════════════════════════ */}
          {!loading && progress && activeView === 'overview' && (
            <div data-tour="dashboard-main">
              {/* ── HERO SECTION ───────────────────────────────────────────────── */}
              <div style={{ background: 'linear-gradient(135deg, #0D2E5A 0%, #1B4F8A 100%)', borderRadius: 16, padding: '28px 32px', marginBottom: 20, color: '#fff', position: 'relative', overflow: 'hidden' }}>
                {/* Decorative circle */}
                <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ position: 'absolute', bottom: -20, right: 60, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />

                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                  {/* Left: welcome text + progress bar (everything that
                      determined hero height before the walkthrough button
                      existed). flex: 1 + minWidth: 240 lets it wrap below
                      the button on narrow viewports without squishing. */}
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, marginBottom: 4 }}>
                      Welcome back, {studentName || 'Student'}!
                    </h1>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 16 }}>
                      {totalPassed === 0 ? 'Start your financial modeling journey today.' :
                       totalPassed === totalSessions ? 'Congratulations! You\'ve completed all sessions.' :
                       `You've completed ${totalPassed} of ${totalSessions} sessions. Keep going!`}
                    </p>

                    {/* Overall progress bar */}
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Overall Progress</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#2EAA4A' }}>{overallPct}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #2EAA4A, #34D058)', width: `${overallPct}%`, transition: 'width 0.8s ease' }} />
                      </div>
                    </div>
                  </div>

                  {/* Right: Watch Platform Walkthrough — only renders when
                      an admin has set platform_walkthrough_url. Sits on the
                      right of the hero so it doesn't add vertical height.
                      Gold gradient matches the platform's accent (Points
                      stat, 100%-progress bar, certified badge) and pops
                      against the navy hero gradient. */}
                  {walkthroughUrl && (
                    <button
                      onClick={() => setWalkthroughOpen(true)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '11px 18px', flexShrink: 0,
                        background: 'linear-gradient(135deg, #C9A84C 0%, #D4AF37 100%)',
                        color: '#0D2E5A',
                        border: 'none', borderRadius: 999,
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        boxShadow: '0 6px 20px rgba(201,168,76,0.45)',
                      }}
                    >
                      <PlayCircle size={16} /> Watch Platform Walkthrough
                    </button>
                  )}
                </div>
              </div>

              {/* ── STATS ROW ──────────────────────────────────────────────────── */}
              <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  { icon: '\u{1F525}', value: streak, label: 'Day Streak', color: '#F59E0B', bg: '#FFFBEB' },
                  { icon: '\u{2B50}', value: points.toLocaleString(), label: 'Points', color: '#C9A84C', bg: '#FFFBF0' },
                  { icon: '\u{1F3C6}', value: badges.length, label: 'Badges', color: '#8B5CF6', bg: '#F5F3FF' },
                  { icon: '\u{1F4DC}', value: certificates.length, label: 'Certificates', color: '#0D2E5A', bg: '#EFF6FF' },
                ].map((stat, i) => (
                  <div key={i} style={{ background: stat.bg, borderRadius: 12, padding: '16px 18px', border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      {stat.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, lineHeight: 1.1 }}>{stat.value}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, marginTop: 2 }}>{stat.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── QUICK ACTIONS ──────────────────────────────────────────────── */}
              <div className="dash-quick-actions" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
                {nextAssessment && (
                  <button onClick={() => navigateTo('course', nextAssessment.courseId)}
                    style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid #E5E7EB', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#0D2E5A', transition: 'box-shadow 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <FileText size={16} /> Next Assessment
                  </button>
                )}
                {upcomingSessions.length > 0 && (
                  <Link href="/training/live-sessions"
                    style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid #E5E7EB', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#0D2E5A', textDecoration: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <Video size={16} /> Live Session
                  </Link>
                )}
                {enrolledCourses.length > 0 && (
                  <button onClick={() => downloadTranscript(enrolledCourses[0])} disabled={generating || totalPassed === 0}
                    style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid #E5E7EB', cursor: totalPassed === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: totalPassed === 0 ? '#9CA3AF' : '#0D2E5A', opacity: totalPassed === 0 ? 0.6 : 1, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <FileText size={16} /> {generating ? 'Generating...' : 'Transcript'}
                  </button>
                )}
                <button onClick={() => document.getElementById('dash-badges')?.scrollIntoView({ behavior: 'smooth' })}
                  style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid #E5E7EB', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#0D2E5A', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                  <Medal size={16} /> View Badges
                </button>
              </div>

              {/* ── LIVE SESSIONS (Upcoming + Recorded) ────────────────────────── */}
              {localSession && (
                <LiveSessionsSection
                  studentEmail={localSession.email}
                  studentName={studentName}
                  registrationId={localSession.registrationId}
                />
              )}

              {/* ── MY COURSES ─────────────────────────────────────────────────── */}
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', margin: '0 0 14px' }}>My Certification Courses</h2>
                <div className="dash-courses-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  {/* Both 3SFM and BVM always render so students see the full
                      path. BVM is locked until the student has a BVM enrollment
                      row (auto-created on 3SFM Final pass in submit-assessment).
                      The locked card is click-through-safe: no link into the
                      course, no sessions exposed, CTA redirects to 3SFM. */}
                  {(['3sfm', 'bvm'] as const).map((cId, cardIdx) => {
                    const c = COURSES[cId];
                    if (!c) return null;
                    const isEnrolled = enrolledCourses.includes(cId);
                    const stats = isEnrolled ? getCourseStats(cId) : { passed: 0, total: c.sessions.length, pct: 0, avgScore: 0, bestScore: 0, bestSession: '' as string | null };
                    const isLocked = cId === 'bvm' && !isEnrolled;
                    const icon = c.shortTitle === '3SFM' ? '\u{1F4CA}' : '\u{1F3E2}';
                    const tourAttr = cardIdx === 0 ? { 'data-tour': 'course-card' } : {};

                    if (isLocked) {
                      return (
                        <div
                          key={cId}
                          {...tourAttr}
                          title="Complete 3SFM Final Exam to unlock Business Valuation Modeling"
                          style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 200, opacity: 0.72 }}
                        >
                          <div style={{ marginBottom: 12 }}><Lock size={36} color="#9CA3AF" /></div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{c.title}</div>
                          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>{c.shortTitle} &middot; {c.sessions.length} {c.sessions.length === 1 ? 'lesson' : 'lessons'}</div>
                          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14, maxWidth: 260 }}>
                            Complete the 3SFM Final Exam to unlock.
                          </div>
                          <button
                            onClick={() => navigateTo('course', '3sfm')}
                            style={{ padding: '8px 20px', borderRadius: 8, background: '#F3F4F6', border: '1px solid #E5E7EB', color: '#6B7280', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                          >
                            Go to 3SFM
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div key={cId} {...tourAttr} style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '24px', position: 'relative', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                        {/* Top color band */}
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: stats.pct === 100 ? '#C9A84C' : '#2EAA4A' }} />

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                          <span style={{ fontSize: 24 }}>{icon}</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A' }}>{c.title}</div>
                            <div style={{ fontSize: 11, color: '#9CA3AF' }}>{c.shortTitle}</div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <span style={{ fontSize: 11, color: '#6B7280' }}>{stats.passed}/{stats.total} Sessions</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: stats.pct === 100 ? '#C9A84C' : '#2EAA4A' }}>{stats.pct}%</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, background: stats.pct === 100 ? 'linear-gradient(90deg, #C9A84C, #D4AF37)' : 'linear-gradient(90deg, #2EAA4A, #34D058)', width: `${stats.pct}%`, transition: 'width 0.5s ease' }} />
                          </div>
                        </div>

                        {/* Stats */}
                        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                          <div>
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>Avg Score</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{stats.avgScore > 0 ? `${stats.avgScore}%` : '--'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>Best Score</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>
                              {stats.bestScore > 0 ? `${stats.bestScore}%` : '--'}
                              {stats.bestSession && <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 3 }}>({stats.bestSession})</span>}
                            </div>
                          </div>
                        </div>

                        <button onClick={() => navigateTo('course', cId)}
                          style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#0D2E5A', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          {stats.passed === 0 ? 'Start Learning' : stats.pct === 100 ? 'Review Course' : 'Continue Learning'} &#8594;
                        </button>
                      </div>
                    );
                  })}

                  {/* Previous "Enrol in BVM" call-to-action card retired. BVM
                      now renders unconditionally inside the main map above
                      with a locked state when the student isn't yet enrolled;
                      enrollment happens automatically on 3SFM Final pass in
                      /api/training/submit-assessment. */}
                </div>
              </div>

              {/* ── ACHIEVEMENTS SECTION ───────────────────────────────────────── */}
              <div id="dash-achievements" style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', margin: '0 0 14px' }}>My Achievements</h2>

                {/* Certificates */}
                {certificates.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    {sortedCertificates.map(cert => (
                      <CertificateImageCard key={cert.certificateId} cert={cert} />
                    ))}
                  </div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: '20px 24px', marginBottom: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>&#127942;</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>No Certificates Yet</div>
                    <div style={{ fontSize: 12, color: '#9CA3AF' }}>Complete all sessions and the final exam to earn your certificate.</div>
                  </div>
                )}

                {/* Certificate Badges (actual badge PNGs) */}
                {certificates.length > 0 && (
                  <div id="dash-badges" style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: '20px 24px', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', margin: '0 0 14px' }}>Certificate Badges</h3>
                    <div className="dash-badges-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                      {sortedCertificates.map(cert => {
                        const badgeImgUrl = cert.badgeUrl || '';
                        // cert.course is the full title ("3-Statement Financial
                        // Modeling"); uppercase-ing it renders a wall of text
                        // in the tiny badge tile. Prefer the canonical short
                        // code from course_code; fall back to a best-effort
                        // match against the free-form title for legacy rows.
                        const courseLabel = cert.courseCode?.toUpperCase()
                          ?? (/\b3SFM|3-statement/i.test(cert.course) ? '3SFM'
                              : /\bBVM|business valuation/i.test(cert.course) ? 'BVM'
                              : cert.course.toUpperCase());
                        const learnUrl = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com') : '';
                        const verifyUrl = cert.certificateId ? `${learnUrl}/verify/${cert.certificateId}` : (cert.verificationUrl ?? '');
                        const shareEvent = {
                          templateKey: 'certificate_earned',
                          title:       '🎉 Share Your Certificate',
                          url:         verifyUrl,
                          cardImageUrl:     cert.certificateId ? `/api/og/certificate/${cert.certificateId}` : undefined,
                          cardDownloadName: cert.certificateId ? `FMP-Certificate-${cert.certificateId}.png` : undefined,
                          vars: {
                            studentName: cert.studentName || studentName,
                            course:      COURSES[cert.course]?.title ?? cert.course,
                            grade:       cert.grade || 'Pass',
                            date:        formatShareDate(cert.issuedAt),
                            certId:      cert.certificateId,
                            verifyUrl,
                          },
                        };
                        return (
                          <div key={cert.certificateId} style={{ textAlign: 'center', padding: '16px 12px', borderRadius: 12, background: '#FFFBF0', border: '1px solid #FDE68A' }}>
                            <div style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto 10px', overflow: 'hidden', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #C9A84C' }}>
                              {badgeImgUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={badgeImgUrl} alt={`${courseLabel} Badge`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: 28, fontWeight: 800, color: '#C9A84C' }}>{cert.course.slice(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', marginBottom: 2 }}>{courseLabel} Certified</div>
                            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
                              Earned {cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                            </div>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                              {badgeImgUrl && (
                                <button onClick={() => setBadgePreview({ url: badgeImgUrl, label: `${courseLabel} Badge` })}
                                  style={{ padding: '5px 10px', borderRadius: 6, background: '#F3F4F6', color: '#374151', fontSize: 10, fontWeight: 700, border: '1px solid #E5E7EB', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <Eye size={11} /> Preview
                                </button>
                              )}
                              {badgeImgUrl && (
                                <a href={`/api/training/badges/download?certId=${encodeURIComponent(cert.certificateId)}`} target="_blank" rel="noopener noreferrer"
                                  style={{ padding: '5px 10px', borderRadius: 6, background: '#0D2E5A', color: '#fff', fontSize: 10, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <Download size={11} /> Download
                                </a>
                              )}
                              {/* Share - opens the dashboard ShareModal (template-driven).
                                  The modal itself has LinkedIn / WhatsApp / Twitter / Copy
                                  buttons, so a single entry point gives the student every
                                  platform while keeping the copy admin-editable via the
                                  `certificate_earned` share template. */}
                              <button onClick={() => setShareModal(shareEvent)}
                                style={{ padding: '5px 10px', borderRadius: 6, background: '#0A66C2', color: '#fff', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                Share
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Progress Badges (gamification) */}
                <div id={certificates.length === 0 ? 'dash-badges' : undefined} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', margin: 0 }}>Progress Badges ({badges.length})</h3>
                  </div>
                  {badges.length > 0 ? (
                    <div className="dash-badges-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                      {badges.map(b => {
                        const meta = BADGE_META[b.badge_key];
                        if (!meta) return null;
                        return (
                          <div key={b.badge_key} style={{ textAlign: 'center', padding: '14px 8px', borderRadius: 10, background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                            <div style={{ marginBottom: 6 }}><BadgeIcon meta={meta} /></div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 2 }}>{meta.label}</div>
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>{meta.desc}</div>
                            <div style={{ fontSize: 9, color: '#D1D5DB', marginTop: 4 }}>
                              {new Date(b.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#9CA3AF', fontSize: 12 }}>
                      Complete sessions to start earning badges!
                    </div>
                  )}

                  {/* Available badges preview */}
                  {badges.length < Object.keys(BADGE_META).length && (
                    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Locked Badges</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {Object.entries(BADGE_META).filter(([key]) => !badges.some(b => b.badge_key === key)).map(([key, meta]) => (
                          <div key={key} title={`${meta.label}: ${meta.desc}`} style={{ cursor: 'default' }}>
                            <BadgeIcon meta={meta} size={32} locked />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Transcript download buttons retired from the achievements
                    section. Transcripts are now downloaded exclusively via
                    the Download Transcript link inside each CertificateImageCard
                    (which routes through /api/training/transcript-cached/[id]
                    with the proper cached URL), plus the per-course Progress
                    Transcript button in the course header. Error toasts from
                    downloadTranscript() now surface through the shared
                    dashToast overlay at the bottom of the page. */}

                {/* Testimonial shortcut */}
                {totalPassed >= 1 && !testimonialSubmitted && (
                  <button onClick={() => setTestimonialModal('written')}
                    style={{ marginTop: 12, padding: '10px 18px', borderRadius: 8, background: '#FFFBF0', border: '1px solid #FDE68A', color: '#92400E', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    &#11088; Share Your Experience
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════ */}
          {/* COURSE VIEW (existing behavior)                                     */}
          {/* ════════════════════════════════════════════════════════════════════ */}
          {!loading && progress && activeView === 'course' && (
            <>
              {/* Back to overview - inline */}
              <button onClick={() => navigateTo('overview')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, background: 'none', border: '1px solid #D1D5DB', color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 16 }}>
                <ArrowLeft size={14} /> Back to Dashboard
              </button>

              {/* Sticky breadcrumb bar - appears on scroll */}
              {scrolledDown && (
                <div style={{
                  position: 'fixed', top: 64, left: sidebarW, right: 0, zIndex: 140,
                  background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
                  borderBottom: '1px solid #E5E7EB', padding: '8px 24px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  transition: 'left 0.3s ease',
                }} className="dash-sticky-breadcrumb">
                  <button onClick={() => navigateTo('overview')}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#1B4F8A', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    <ArrowLeft size={14} /> Dashboard
                  </button>
                  <span style={{ color: '#D1D5DB', fontSize: 12 }}>/</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>
                    {COURSES[displayCourse]?.title ?? displayCourse.toUpperCase()}
                  </span>
                </div>
              )}

              <CourseContent
                courseId={activeCourse === 'bvm' ? 'bvm' : displayCourse}
                progressMap={progressMap}
                certificates={certificates}
                liveLinks={liveLinks}
                courseDescs={courseDescs}
                regId={localSession?.registrationId ?? ''}
                onDownloadTranscript={(cId) => downloadTranscript(cId)}
                generating={generating}
                studentName={progress?.student.name ?? ''}
                studentEmail={progress?.student.email ?? ''}
                onShare={event => setShareModal(event)}
                testimonialSubmitted={testimonialSubmitted}
                onOpenTestimonial={type => setTestimonialModal(type)}
                notes={notes}
                onNoteSave={saveNote}
                feedbackGiven={feedbackGiven}
                onFeedbackRequest={(sessionKey, sessionTitle) => setFeedbackModal({ sessionKey, sessionTitle })}
                bvmLocked={showLockedBvm}
                sfmProgress={sfmPassedCount}
                sfmTotal={sfmRegular.length}
                onSwitchTo3sfm={() => navigateTo('course', '3sfm')}
                timerBypassed={timerBypassed}
                completedWatchKeys={certWatchCompleted}
                inProgressWatchKeys={certWatchInProgress}
                watchPctMap={watchPctMap}
                watchThreshold={watchThreshold}
              />
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════════ */}
          {/* LIVE SESSIONS TAB                                                   */}
          {/* ════════════════════════════════════════════════════════════════════ */}
          {activeView === 'live-sessions' && localSession && (
            <LiveSessionsContent
              studentEmail={localSession.email}
              studentName={studentName}
              registrationId={localSession.registrationId}
            />
          )}
        </main>
      </div>

      {/* ── Mobile Bottom Navigation ──────────────────────────────────────── */}
      <div className="dash-bottom-nav">
        {[
          { icon: '\u{1F3E0}', label: 'Home', action: () => navigateTo('overview'), active: activeView === 'overview' },
          { icon: '\u{1F4CA}', label: 'Courses', action: () => navigateTo('course', enrolledCourses[0] ?? '3sfm'), active: activeView === 'course' },
          { icon: '\u{1F4FA}', label: 'Live', action: () => navigateTo('live-sessions'), active: activeView === 'live-sessions' },
          { icon: '\u{1F3C6}', label: 'Achieve', action: () => { navigateTo('overview'); setTimeout(() => document.getElementById('dash-achievements')?.scrollIntoView({ behavior: 'smooth' }), 100); }, active: false },
          { icon: '\u{1F464}', label: 'Profile', action: () => { setProfileModal(true); }, active: false },
        ].map(item => (
          <button key={item.label} onClick={item.action}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: item.active ? '#2EAA4A' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '6px 0', fontSize: 16 }}>
            <span>{item.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700 }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* ── Course Share Modal ────────────────────────────────────────────── */}
      {courseShareOpen && (() => {
        const courseTxt = `I'm making progress on Financial Modeler Pro - free professional financial modeling certification!\n\nBuilding institutional-grade financial models - completely free.\n\n👉 https://learn.financialmodelerpro.com\n\n#FinancialModeling #CorporateFinance #FinancialModelerPro`;
        return (
          <div onClick={() => { setCourseShareOpen(false); setCourseShareCopied(false); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: 'calc(100vw - 32px)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>Share Your Progress</div>
                <button onClick={() => { setCourseShareOpen(false); setCourseShareCopied(false); }} style={{ background: 'none', border: 'none', fontSize: 18, color: '#6B7280', cursor: 'pointer', lineHeight: 1 }}>&#10005;</button>
              </div>
              <textarea readOnly value={courseTxt} rows={6}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'none', lineHeight: 1.6, boxSizing: 'border-box', marginBottom: 12, color: '#374151', background: '#F9FAFB' }} />
              <div style={{ fontSize: 12, color: '#6B7280', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '10px 14px', marginBottom: 12, lineHeight: 1.5 }}>
                💡 Click <strong>Share on LinkedIn</strong> - your text is auto-copied. Just <strong>paste it (Ctrl+V)</strong> in LinkedIn.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { navigator.clipboard.writeText(courseTxt).catch(() => {}); window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank'); }}
                  style={{ flex: 1, padding: '10px 14px', background: '#0077b5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  💼 Share on LinkedIn
                </button>
                <button onClick={() => { navigator.clipboard.writeText(courseTxt).then(() => { setCourseShareCopied(true); setTimeout(() => setCourseShareCopied(false), 2500); }).catch(() => {}); }}
                  style={{ flex: 1, padding: '10px 14px', background: courseShareCopied ? '#F0FDF4' : '#F3F4F6', color: courseShareCopied ? '#16A34A' : '#374151', border: `1px solid ${courseShareCopied ? '#86EFAC' : '#E5E7EB'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {courseShareCopied ? '✓ Copied!' : '🔗 Copy Text'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Badge Preview Modal ──────────────────────────────────────────── */}
      {badgePreview && (
        <div onClick={() => setBadgePreview(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', position: 'relative', textAlign: 'center' }}>
            <button onClick={() => setBadgePreview(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
              <X size={20} />
            </button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D2E5A', marginBottom: 16 }}>{badgePreview.label}</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgePreview.url} alt={badgePreview.label} style={{ width: '100%', maxWidth: 360, borderRadius: 12, border: '1px solid #E5E7EB' }} />
          </div>
        </div>
      )}

      {/* ── Share Modal ─────────────────────────────────────────────────────── */}
      {shareModal && (
        <ShareModal
          templateKey={shareModal.templateKey}
          vars={shareModal.vars}
          title={shareModal.title}
          url={shareModal.url}
          cardImageUrl={shareModal.cardImageUrl}
          cardDownloadName={shareModal.cardDownloadName}
          onClose={() => setShareModal(null)}
          onCopyDone={() => { setDashToast('Link copied to clipboard!'); setTimeout(() => setDashToast(''), 2500); }}
        />
      )}

      {/* ── Onboarding Tour ────────────────────────────────────────────────── */}
      {tourReady && (
        <DashboardTour
          run={tourRun}
          studentName={studentName}
          onComplete={handleTourComplete}
        />
      )}

      {/* ── Share Experience Modal ─────────────────────────────────────────── */}
      {testimonialModal && localSession && progress && (
        <ShareExperienceModal
          isOpen={true}
          onClose={() => setTestimonialModal(null)}
          onSuccess={() => {
            setTestimonialSubmitted(true);
            try { localStorage.setItem(`fmp_test_${localSession.registrationId}`, 'true'); } catch { /* ignore */ }
            setDashToast('Thank you! Your testimonial has been submitted for review.');
            setTimeout(() => setDashToast(''), 4000);
          }}
          studentName={progress.student.name}
          studentEmail={progress.student.email}
          regId={localSession.registrationId}
          jobTitle={studentProfile?.job_title}
          company={studentProfile?.company}
          linkedinUrl={studentProfile?.linkedin_url}
          hub="training"
          sessionsCompleted={totalPassed}
          courseCode={activeCourse}
          courseName={COURSES[activeCourse]?.title ?? activeCourse.toUpperCase()}
          certificationEarned={certificates.length > 0}
          verificationUrl={certificates[0]?.verificationUrl ?? (certificates[0]?.certificateId ? `${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/verify/${certificates[0].certificateId}` : '')}
          defaultTab={testimonialModal}
        />
      )}

      {/* ── Avatar crop modal (react-easy-crop) ─────────────────────────────── */}
      {cropImageSrc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={cancelAvatarPreview}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '92%', boxShadow: '0 8px 40px rgba(0,0,0,0.35)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 12px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', marginBottom: 4 }}>Crop Profile Photo</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Drag to reposition. Use the slider to zoom.</div>
            </div>
            <div style={{ position: 'relative', width: '100%', height: 300, background: '#1a1a2e' }}>
              <Cropper
                image={cropImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div style={{ padding: '16px 24px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0, fontWeight: 600 }}>Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={e => setZoom(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#1B4F8A' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={cancelAvatarPreview}
                  style={{ flex: 1, padding: '11px', background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={confirmAvatarUpload} disabled={avatarUploading}
                  style={{ flex: 1, padding: '11px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: avatarUploading ? 'not-allowed' : 'pointer', opacity: avatarUploading ? 0.7 : 1 }}>
                  {avatarUploading ? 'Uploading...' : 'Save Photo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Dashboard toast ─────────────────────────────────────────────────── */}
      {dashToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '11px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', maxWidth: 340 }}>
          {dashToast}
        </div>
      )}

      {/* ── Badge toast ──────────────────────────────────────────────────────── */}
      {newBadgeToast && (
        <div style={{ position: 'fixed', bottom: 64, right: 24, background: '#92400E', color: '#fff', padding: '11px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: 300 }}>
          {newBadgeToast}
        </div>
      )}

      {/* ── Session Feedback Modal ───────────────────────────────────────────── */}
      {feedbackModal && localSession && (
        <FeedbackModal
          sessionTitle={feedbackModal.sessionTitle}
          onClose={() => setFeedbackModal(null)}
          onSubmit={(rating, comment) => {
            saveFeedback(feedbackModal.sessionKey, rating, comment);
            setFeedbackModal(null);
            setDashToast('Thanks for your feedback!');
            setTimeout(() => setDashToast(''), 2500);
          }}
        />
      )}

      {/* ── Profile Modal ────────────────────────────────────────────────────── */}
      {profileModal && localSession && (
        <ProfileModal
          registrationId={localSession.registrationId}
          initial={studentProfile}
          onClose={() => setProfileModal(false)}
          onSave={(profile) => {
            setStudentProfile(profile);
            setProfileModal(false);
            setDashToast('Profile saved!');
            setTimeout(() => setDashToast(''), 2500);
          }}
        />
      )}

      {/* ── Platform Walkthrough Modal ───────────────────────────────────────── */}
      {walkthroughOpen && walkthroughUrl && (() => {
        const ytId = extractYouTubeId(walkthroughUrl);
        // YouTube → embed iframe with autoplay. Anything else (Vimeo,
        // self-hosted) is rendered via a generic iframe of the URL — most
        // hosts allow direct embedding, and worst case the student sees a
        // standard "open in new tab" link below as a fallback.
        const embedSrc = ytId
          ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`
          : walkthroughUrl;
        return (
          <div
            onClick={() => setWalkthroughOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px', boxSizing: 'border-box',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'relative', width: '100%', maxWidth: 980,
                background: '#000', borderRadius: 12, overflow: 'hidden',
                boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
              }}
            >
              <button
                onClick={() => setWalkthroughOpen(false)}
                aria-label="Close walkthrough"
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 2,
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={18} />
              </button>
              <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
                <iframe
                  src={embedSrc}
                  title="Platform Walkthrough"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: '100%', border: 'none',
                  }}
                />
              </div>
              {!ytId && (
                <div style={{ padding: '10px 14px', background: '#0D2E5A', textAlign: 'center' }}>
                  <a href={walkthroughUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#93C5FD', fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}>
                    Trouble loading? Open in new tab →
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
