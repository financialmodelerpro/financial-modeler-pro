'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession, clearTrainingSession } from '@/src/lib/training/training-session';
import { COURSES } from '@/src/config/courses';
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
  TestimonialModal,
  FeedbackModal,
  ProfileModal,
} from '@/src/components/training/dashboard';

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export default function TrainingDashboardPage() {
  const router = useRouter();

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
  const [transcriptToast, setTranscriptToast]     = useState('');
  const [lastUpdated, setLastUpdated]             = useState<Date | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // share + testimonials
  const [shareModal, setShareModal]               = useState<{ label: string; certUrl?: string } | null>(null);
  const [testimonialModal, setTestimonialModal]   = useState<'written' | 'video' | null>(null);
  const [testimonialSubmitted, setTestimonialSubmitted] = useState(false);
  const [dashToast, setDashToast]                 = useState('');
  // streak / gamification
  const [streak, setStreak]                       = useState(0);
  const [points, setPoints]                       = useState(0);
  const [badges, setBadges]                       = useState<{ badge_key: string; earned_at: string }[]>([]);
  const [newBadgeToast, setNewBadgeToast]         = useState('');
  // notes
  const [notes, setNotes]                         = useState<Record<string, string>>({});
  // feedback
  const [feedbackGiven, setFeedbackGiven]         = useState<Set<string>>(new Set());
  const [feedbackModal, setFeedbackModal]         = useState<{ sessionKey: string; sessionTitle: string } | null>(null);
  // profile
  const [profileModal, setProfileModal]           = useState(false);
  const [profileDropdown, setProfileDropdown]     = useState(false);
  const [studentProfile, setStudentProfile]       = useState<{ job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; display_name?: string; avatar_url?: string } | null>(null);
  const [avatarUploading, setAvatarUploading]     = useState(false);
  const [avatarPreview, setAvatarPreview]         = useState<{ src: string; blob: Blob } | null>(null);
  const sidebarFileInputRef                       = useRef<HTMLInputElement>(null);
  // share CMS text (fetched once, cached 10 min)
  const [shareCms, setShareCms]                   = useState<{ title: string; messageTemplate: string }>({ title: '', messageTemplate: '' });

  // Restore sidebar state from localStorage (client-only)
  useEffect(() => {
    if (localStorage.getItem('dashboardSidebarCollapsed') === 'true') setSidebarCollapsed(true);
  }, []);

  // Fetch share CMS text once on mount
  useEffect(() => {
    fetch('/api/cms?section=training&keys=share_achievement_title,share_default_message')
      .then(r => r.json())
      .then((j: { map?: Record<string, string> }) => {
        const title = j.map?.['training__share_achievement_title'] ?? '';
        const msg   = j.map?.['training__share_default_message'] ?? '';
        if (title || msg) setShareCms({ title, messageTemplate: msg });
      })
      .catch(() => {});
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('dashboardSidebarCollapsed', String(next));
  }

  const loadData = useCallback(async (
    sess: { email: string; registrationId: string },
    forceRefresh = false,
  ) => {
    // ── Issue 4: Show cached progress immediately, then refresh in background ─
    const CACHE_KEY = `fmp_progress_${sess.registrationId}`;
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { data: ProgressData; at: number };
          if (Date.now() - cached.at < CACHE_TTL) {
            setProgress(cached.data);
            setLoading(false); // show cached data instantly; fetch continues in background
          }
        }
      } catch { /* ignore — stale or corrupt cache */ }
    }

    // Bust localStorage cache on force-refresh so stale empty-sessions data is evicted
    if (forceRefresh) {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    }
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setIsFallback(false);
    try {
      const progressParams = new URLSearchParams({ email: sess.email, registrationId: sess.registrationId });
      if (forceRefresh) progressParams.set('refresh', '1');

      // ── Fetch progress + course-details + notes + profile in PARALLEL ───
      const [progressRes, detailsRes, notesRes, profileRes] = await Promise.all([
        fetch(`/api/training/progress?${progressParams}`),
        fetch('/api/training/course-details'),
        fetch(`/api/training/notes?registrationId=${encodeURIComponent(sess.registrationId)}`),
        fetch(`/api/training/profile?registrationId=${encodeURIComponent(sess.registrationId)}`),
      ]);

      const [json, detailsJson, notesJson, profileJson] = await Promise.all([
        progressRes.json() as Promise<{ success: boolean; fallback?: boolean; data?: ProgressData }>,
        detailsRes.json() as Promise<{ sessions?: { tabKey: string; sessionName: string; youtubeUrl: string; formUrl: string; videoDuration: number; isFinal: boolean; hasVideo: boolean }[]; courses?: CourseDescsMap }>,
        notesRes.json() as Promise<{ notes?: { session_key: string; content: string }[] }>,
        profileRes.json() as Promise<{ profile?: { job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; streak_days?: number; total_points?: number; display_name?: string; avatar_url?: string } | null }>,
      ]);

      // Apply notes
      const notesMap: Record<string, string> = {};
      for (const n of notesJson.notes ?? []) notesMap[n.session_key] = n.content;
      setNotes(notesMap);

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
      // Debug: verify final session data and video durations from Apps Script
      console.log('[CourseDetails] 3SFM_Final:', map['3SFM_Final'] ?? 'NOT FOUND — check Apps Script tabKey');
      console.log('[CourseDetails] BVM_Final:', map['BVM_Final'] ?? 'NOT FOUND — check Apps Script tabKey');
      console.log('[CourseDetails] 3SFM_S1 duration:', map['3SFM_S1']?.videoDuration ?? 'undefined — check Apps Script col J');
      setLiveLinks(map);
      if (detailsJson.courses) setCourseDescs(detailsJson.courses);

      // Apply progress
      if (json.success && json.data) {
        setProgress(json.data);
        setLastUpdated(new Date());
        // Persist to localStorage so next load shows data instantly
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: json.data, at: Date.now() })); } catch { /* ignore */ }
        // Fire activity (streak/badges) — fire-and-forget
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
              setNewBadgeToast(`🏅 New badge earned: ${act.newBadges[0].replace(/_/g, ' ')}`);
              setTimeout(() => setNewBadgeToast(''), 4000);
            }
          }
        }).catch(() => {});
        if (json.fallback) setIsFallback(true);
        if (json.data.certificateIssued) {
          const certRes  = await fetch(`/api/training/certificate?email=${encodeURIComponent(sess.email)}`);
          const certJson = await certRes.json() as { success: boolean; data?: Certificate[] };
          if (certJson.success && certJson.data) setCertificates(certJson.data);
        }
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
    if (!sess) { router.replace('/training/login'); return; }
    setLocalSession(sess);
    loadData(sess);
    // Restore testimonial submitted state from localStorage
    try {
      if (localStorage.getItem(`fmp_test_${sess.registrationId}`) === 'true') {
        setTestimonialSubmitted(true);
      }
    } catch { /* ignore */ }
  }, [router, loadData]);

  async function downloadTranscript(courseId: string) {
    if (!localSession || !progress) return;
    setGenerating(true);
    setTranscriptToast('');
    try {
      const shortTitle = COURSES[courseId]?.shortTitle ?? courseId.toUpperCase();
      const params = new URLSearchParams({ regId: localSession.registrationId, email: localSession.email, course: courseId });
      const res = await fetch(`/api/training/transcript?${params}`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `FMP-Transcript-${localSession.registrationId}-${shortTitle}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setTranscriptToast('Could not generate transcript. Please try again.');
      setTimeout(() => setTranscriptToast(''), 4000);
    } finally {
      setGenerating(false);
    }
  }

  function cropImageToSquare(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable')); return; }
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, size, size);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Crop failed'));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
      img.src = objectUrl;
    });
  }

  async function handleSidebarPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setDashToast('File too large — maximum size is 2 MB.');
      setTimeout(() => setDashToast(''), 4000);
      if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
      return;
    }
    try {
      const blob = await cropImageToSquare(file);
      const src = URL.createObjectURL(blob);
      setAvatarPreview({ src, blob });
    } catch {
      setDashToast('Could not load image — try a different file.');
      setTimeout(() => setDashToast(''), 4000);
      if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
    }
  }

  async function confirmAvatarUpload() {
    if (!avatarPreview || !localSession) return;
    setAvatarUploading(true);
    const previewSrc = avatarPreview.src;
    setAvatarPreview(null);
    if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
    try {
      const fd = new FormData();
      fd.append('file', new File([avatarPreview.blob], 'avatar.jpg', { type: 'image/jpeg' }));
      fd.append('regId', localSession.registrationId);
      const res = await fetch('/api/training/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      const busted = `${data.url}?v=${Date.now()}`;
      URL.revokeObjectURL(previewSrc);
      await fetch('/api/training/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: localSession.registrationId, avatarUrl: busted }),
      });
      setStudentProfile(prev => prev ? { ...prev, avatar_url: busted } : { avatar_url: busted });
      setDashToast('Profile photo updated');
      setTimeout(() => setDashToast(''), 3000);
    } catch {
      URL.revokeObjectURL(previewSrc);
      setDashToast('Upload failed — please try again.');
      setTimeout(() => setDashToast(''), 4000);
    } finally {
      setAvatarUploading(false);
    }
  }

  function cancelAvatarPreview() {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview.src);
    setAvatarPreview(null);
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

  // BVM unlock: all 17 3SFM sessions + S18 final must be passed
  const sfmFinalSession = COURSES['3sfm']?.sessions.find(s => s.isFinal);
  const bvmUnlocked     = allRegularSessionsPassed('3sfm', progressMap) &&
    (sfmFinalSession ? progressMap.get(sfmFinalSession.id)?.passed === true : false);

  // 3SFM stats (for BVM locked state) — includes final exam
  const sfmRegular    = COURSES['3sfm']?.sessions ?? [];
  const sfmPassedCount = sfmRegular.filter(s => progressMap.get(s.id)?.passed).length;

  // Student avatar initials — prefer profile display_name over registration name
  const studentName = studentProfile?.display_name || progress?.student.name || '';
  const initials = studentName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';
  const avatarUrl = studentProfile?.avatar_url || '';

  // Overall progress — includes final exam
  const totalSessions = enrolledCourses.reduce((s, cId) => s + (COURSES[cId]?.sessions.length ?? 0), 0);
  const totalPassed   = enrolledCourses.reduce((s, cId) => {
    const c = COURSES[cId]; if (!c) return s;
    return s + c.sessions.filter(x => progressMap.get(x.id)?.passed).length;
  }, 0);

  const isEnrolledInBvm = enrolledCourses.includes('bvm');

  // What to show in main area
  const showLockedBvm = activeCourse === 'bvm' && !bvmUnlocked;
  // Effective course to render (fall back to first enrolled if activeCourse not enrolled)
  const displayCourse = enrolledCourses.includes(activeCourse) ? activeCourse : (enrolledCourses[0] ?? '3sfm');

  const sidebarW = sidebarCollapsed ? 60 : 260;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>

      {/* ── Global styles ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .dash-hamburger { display: none !important; }
        .dash-mob-backdrop { display: none !important; }
        @media (max-width: 767px) {
          .dash-hamburger { display: flex !important; }
          .dash-sidebar {
            position: fixed !important;
            left: ${mobileSidebarOpen ? '0' : '-270px'} !important;
            top: 0 !important; bottom: 0 !important;
            z-index: 200 !important;
            width: 260px !important;
            transition: left 0.3s ease !important;
            overflow-y: auto !important;
          }
          .dash-mob-backdrop {
            display: ${mobileSidebarOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 199;
          }
          .dash-sidebar-toggle { display: none !important; }
          .dash-main { padding: 16px 16px 48px !important; }
          .dash-stats-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Mobile backdrop */}
      <div className="dash-mob-backdrop" onClick={() => setMobileSidebarOpen(false)} />

      {/* ── TOP NAV ──────────────────────────────────────────────────────────── */}
      <div style={{ background: '#0D2E5A', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 150, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Mobile hamburger */}
          <button
            className="dash-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            ☰
          </button>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📐</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Financial Modeler Pro</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Training Hub</div>
            </div>
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
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => setShareModal({ label: 'am learning Financial Modeling' })}
            title="Share your progress"
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            🔗 Share
          </button>
          {/* Profile avatar dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileDropdown(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: '#fff' }}
            >
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
                {avatarUrl ? <img src={avatarUrl} alt={studentName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {studentName || localSession?.registrationId || 'Student'}
              </span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>
            {profileDropdown && (
              <div
                style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.18)', minWidth: 180, zIndex: 300, overflow: 'hidden', border: '1px solid #E5E7EB' }}
                onMouseLeave={() => setProfileDropdown(false)}
              >
                <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{studentName || 'Student'}</div>
                  {studentProfile?.linkedin_url && (
                    <a href={studentProfile.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#0A66C2', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      in LinkedIn Profile ↗
                    </a>
                  )}
                </div>
                {[
                  { icon: '👤', label: 'Edit Profile', action: () => { setProfileModal(true); setProfileDropdown(false); } },
                  { icon: '🚪', label: 'Logout', action: () => { setProfileDropdown(false); handleLogout(); }, color: '#DC2626' },
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: item.color ?? '#374151', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}>
                    <span>{item.icon}</span> {item.label}
                  </button>
                ))}
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
          position: 'sticky', top: 56,
          height: 'calc(100vh - 56px)',
          overflowY: 'auto', overflowX: 'hidden',
          transition: 'width 0.3s ease',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>

          {/* ─ Mobile close button ─ */}
          <div className="dash-hamburger" style={{ padding: '12px 16px 0', justifyContent: 'flex-end' }}>
            <button onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>

          {/* ─ Student Info ─ */}
          <div style={{ padding: sidebarCollapsed ? '16px 8px' : '16px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: sidebarCollapsed ? 'center' : 'flex-start' }}>
                <Skeleton w={40} h={40} radius={20} />
                {!sidebarCollapsed && <><Skeleton w={120} h={13} /><Skeleton w={80} h={11} /></>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: sidebarCollapsed ? 0 : 10 }}>
                  {/* Clickable avatar with upload overlay */}
                  <div
                    title="Change profile photo"
                    className="sidebar-avatar-btn"
                    onClick={() => sidebarFileInputRef.current?.click()}
                    style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'visible', cursor: 'pointer' }}
                  >
                    {/* Avatar circle */}
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2EAA4A', fontSize: 14, fontWeight: 800, color: '#fff', position: 'relative' }}>
                      {avatarUploading ? (
                        <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      ) : avatarUrl ? (
                        <img src={avatarUrl} alt={studentName} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
                      ) : initials}
                      {/* Hover overlay */}
                      {!avatarUploading && (
                        <div className="avatar-hover-overlay" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </div>
                      )}
                    </div>
                    {/* Camera badge — always visible bottom-right */}
                    {!avatarUploading && (
                      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: '#1d4ed8', border: '1.5px solid #0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      </div>
                    )}
                    {/* Hidden file input */}
                    <input
                      ref={sidebarFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleSidebarPhotoSelect}
                    />
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
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Overall Progress</span>
                      <span style={{ fontSize: 10, color: '#2EAA4A', fontWeight: 700 }}>{totalPassed}/{totalSessions}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: '#2EAA4A', width: `${totalSessions > 0 ? (totalPassed / totalSessions) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─ Courses + Achievements ─ */}
          <div style={{ padding: sidebarCollapsed ? '10px 6px' : '10px 10px', flex: 1 }}>

            {/* Section label */}
            {!sidebarCollapsed && (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '6px 4px 6px', marginBottom: 2 }}>
                My Courses
              </div>
            )}

            {/* Enrolled course buttons */}
            {enrolledCourses.map(cId => {
              const c = COURSES[cId];
              if (!c) return null;
              const cReg    = c.sessions.filter(s => !s.isFinal);
              const cPassed = cReg.filter(s => progressMap.get(s.id)?.passed).length;
              const cPct    = cReg.length > 0 ? Math.round((cPassed / cReg.length) * 100) : 0;
              const isActive = activeCourse === cId;
              const isLocked = cId === 'bvm' && !bvmUnlocked;
              const icon = c.shortTitle === '3SFM' ? '📈' : '📊';

              if (sidebarCollapsed) {
                return (
                  <button key={cId} onClick={() => setActiveCourse(cId)}
                    title={isLocked ? `${c.shortTitle} — Locked` : `${c.shortTitle}: ${cPassed}/${cReg.length}`}
                    style={{ width: '100%', background: isActive ? '#1B4F8A' : 'transparent', border: 'none', borderLeft: `3px solid ${isActive ? '#2EAA4A' : 'transparent'}`, borderRadius: 6, padding: '10px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4, fontSize: 18 }}>
                    {isLocked ? '🔒' : icon}
                  </button>
                );
              }

              return (
                <button key={cId} onClick={() => setActiveCourse(cId)}
                  style={{ width: '100%', textAlign: 'left', background: isActive ? '#1B4F8A' : 'rgba(255,255,255,0.04)', border: `1px solid ${isActive ? 'rgba(255,255,255,0.1)' : 'transparent'}`, borderLeft: `3px solid ${isActive ? '#2EAA4A' : 'transparent'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 6, transition: 'background 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isLocked ? 0 : 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{isLocked ? '🔒' : icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isLocked ? 'rgba(255,255,255,0.35)' : '#fff' }}>{c.shortTitle}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: isLocked ? 'rgba(255,255,255,0.06)' : cPct === 100 ? '#C9A84C' : cPassed > 0 ? '#2EAA4A' : 'rgba(255,255,255,0.08)', color: isLocked ? 'rgba(255,255,255,0.25)' : '#fff' }}>
                      {isLocked ? 'LOCKED' : cPct === 100 ? 'DONE' : cPassed > 0 ? 'IN PROGRESS' : 'START'}
                    </span>
                  </div>
                  {!isLocked && (
                    <>
                      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: cPct === 100 ? '#C9A84C' : '#2EAA4A', width: `${cPct}%` }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{cPassed} / {cReg.length} sessions</div>
                    </>
                  )}
                  {isLocked && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Complete 3SFM to unlock</div>}
                </button>
              );
            })}

            {/* BVM hint / Start Another Course */}
            {!isEnrolledInBvm && (
              sidebarCollapsed ? (
                bvmUnlocked ? (
                  <a href="/training/register?course=bvm" title="Enrol in BVM"
                    style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 0', cursor: 'pointer', color: '#2EAA4A', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                    ➕
                  </a>
                ) : (
                  <div title="BVM — Complete 3SFM first" style={{ width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'rgba(255,255,255,0.2)' }}>🔒</div>
                )
              ) : bvmUnlocked ? (
                <a href="/training/register?course=bvm"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: 'rgba(46,170,74,0.1)', border: '1px dashed rgba(46,170,74,0.35)', color: '#2EAA4A', textDecoration: 'none', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                  ➕ Enrol in BVM →
                </a>
              ) : (
                <button onClick={() => setActiveCourse('bvm')}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                  🔒 BVM — Complete 3SFM first
                </button>
              )
            )}

            {/* ─ Streak & Points ─ */}
            {!sidebarCollapsed && (streak > 0 || points > 0) && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', marginTop: 8, marginBottom: 4, display: 'flex', gap: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16 }}>🔥</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: streak >= 5 ? '#F59E0B' : '#fff' }}>{streak}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>day streak</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16 }}>⭐</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#C9A84C' }}>{points}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>points</div>
                </div>
                {badges.length > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16 }}>🏅</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{badges.length}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>badges</div>
                  </div>
                )}
              </div>
            )}

            {/* ─ Badges grid ─ */}
            {!sidebarCollapsed && badges.length > 0 && (() => {
              const BADGE_META: Record<string, { icon: string; label: string }> = {
                first_step:   { icon: '👣', label: 'First Step' },
                on_fire:      { icon: '🔥', label: 'On Fire' },
                unstoppable:  { icon: '⚡', label: 'Unstoppable' },
                halfway:      { icon: '🎯', label: 'Halfway' },
                almost_there: { icon: '🚀', label: 'Almost There' },
                certified:    { icon: '🏆', label: 'Certified' },
                perfect_score:{ icon: '💯', label: 'Perfect Score' },
                speed_runner: { icon: '⚡', label: 'Speed Runner' },
              };
              return (
                <div style={{ padding: '6px 4px 2px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 6 }}>Badges</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {badges.map(b => {
                      const meta = BADGE_META[b.badge_key];
                      if (!meta) return null;
                      return (
                        <span key={b.badge_key} title={meta.label} style={{ fontSize: 16, cursor: 'default' }}>{meta.icon}</span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ─ Achievements ─ */}
            {!sidebarCollapsed && (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '14px 4px 6px', marginTop: 4 }}>
                  My Achievements
                </div>

                {/* Certificates */}
                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: certificates.length > 0 ? '#C9A84C' : 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                    🏆 Certificates ({certificates.length})
                  </div>
                  {certificates.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Complete a course to earn your certificate</div>
                  ) : (
                    certificates.map(cert => (
                      <a key={cert.certificateId} href={cert.certifierUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', fontSize: 11, color: '#C9A84C', textDecoration: 'none', marginTop: 4 }}>
                        {cert.course.toUpperCase()} — View →
                      </a>
                    ))
                  )}
                </div>

                {/* Transcript — one button per enrolled course */}
                {enrolledCourses.map(cId => {
                  const cConfig = COURSES[cId];
                  if (!cConfig) return null;
                  const cPassed = cConfig.sessions.filter(s => progressMap.get(s.id)?.passed).length;
                  const disabled = cPassed === 0 || generating;
                  return (
                    <button key={cId} onClick={() => downloadTranscript(cId)} disabled={disabled}
                      title={cPassed === 0 ? 'Complete at least one session first' : undefined}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span>📄</span> {generating ? 'Generating…' : `Download ${cConfig.shortTitle} Transcript`}
                    </button>
                  );
                })}
                {transcriptToast && (
                  <div style={{ fontSize: 10, color: '#FCA5A5', padding: '4px 4px', marginTop: 4 }}>⚠️ {transcriptToast}</div>
                )}

                {/* Testimonial shortcut */}
                {totalPassed >= 1 && !testimonialSubmitted && (
                  <button onClick={() => setTestimonialModal('written')}
                    style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span>⭐</span> Share Your Experience
                  </button>
                )}
              </>
            )}

            {/* Collapsed achievements icons */}
            {sidebarCollapsed && (
              <div style={{ marginTop: 8 }}>
                {enrolledCourses.map(cId => {
                  const cConfig = COURSES[cId];
                  if (!cConfig) return null;
                  const cPassed = cConfig.sessions.filter(s => progressMap.get(s.id)?.passed).length;
                  const disabled = cPassed === 0 || generating;
                  return (
                    <button key={cId} title={disabled ? 'Complete sessions first' : `Download ${cConfig.shortTitle} Transcript`} onClick={() => downloadTranscript(cId)} disabled={disabled}
                      style={{ width: '100%', background: 'transparent', border: 'none', padding: '6px 0', cursor: disabled ? 'default' : 'pointer', color: disabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      📄
                    </button>
                  );
                })}
                {certificates.length > 0 && (
                  <div title={`${certificates.length} Certificate${certificates.length > 1 ? 's' : ''}`} style={{ width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                    🏆
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─ Account ─ */}
          {!sidebarCollapsed && (
            <div style={{ padding: '10px 10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '4px 4px 8px' }}>
                Account
              </div>
              {progress?.student.email && (
                <div style={{ padding: '4px 4px 8px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Email</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {progress.student.email}
                  </div>
                  {studentProfile?.job_title && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{studentProfile.job_title}{studentProfile.company ? ` · ${studentProfile.company}` : ''}</div>
                  )}
                </div>
              )}
              <button onClick={() => setProfileModal(true)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                👤 Edit Profile
              </button>
              <button onClick={handleLogout}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                🚪 Logout
              </button>
            </div>
          )}

          {/* ─ Collapse toggle ─ */}
          <button className="dash-sidebar-toggle" onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ margin: '8px auto 12px', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
        <main className="dash-main" style={{ flex: 1, minWidth: 0, padding: '28px 28px 64px', overflowY: 'auto' }}>

          {/* Fallback banner */}
          {!loading && isFallback && progress && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#92400E' }}>
                ⚡ Could not load latest progress — showing your course structure. Your data will appear after the next sync.
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Skeleton w={90} h={28} radius={6} />
                    <Skeleton w={120} h={28} radius={6} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Course content */}
          {!loading && progress && (
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
              onShare={(label, certUrl) => setShareModal({ label, certUrl })}
              testimonialSubmitted={testimonialSubmitted}
              onOpenTestimonial={type => setTestimonialModal(type)}
              notes={notes}
              onNoteSave={saveNote}
              feedbackGiven={feedbackGiven}
              onFeedbackRequest={(sessionKey, sessionTitle) => setFeedbackModal({ sessionKey, sessionTitle })}
              bvmLocked={showLockedBvm}
              sfmProgress={sfmPassedCount}
              sfmTotal={sfmRegular.length}
              onSwitchTo3sfm={() => setActiveCourse('3sfm')}
            />
          )}

          {/* Enhanced certificate cards (Certifier image + branded QR) */}
          {!loading && certificates.length > 0 && (
            <div>
              {certificates.map(cert => (
                <CertificateImageCard key={cert.certificateId} cert={cert} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ── Share Modal ─────────────────────────────────────────────────────── */}
      {shareModal && (
        <ShareModal
          label={shareModal.label}
          certUrl={shareModal.certUrl}
          cmsTitle={shareCms.title}
          cmsMessageTemplate={shareCms.messageTemplate}
          onClose={() => setShareModal(null)}
          onCopyDone={() => { setDashToast('Link copied to clipboard!'); setTimeout(() => setDashToast(''), 2500); }}
        />
      )}

      {/* ── Testimonial Modal ───────────────────────────────────────────────── */}
      {testimonialModal && localSession && progress && (
        <TestimonialModal
          mode={testimonialModal}
          studentName={progress.student.name}
          studentEmail={progress.student.email}
          regId={localSession.registrationId}
          courseCode={activeCourse}
          courseName={COURSES[activeCourse]?.title ?? activeCourse.toUpperCase()}
          onClose={() => setTestimonialModal(null)}
          onSuccess={() => {
            setTestimonialSubmitted(true);
            try { localStorage.setItem(`fmp_test_${localSession.registrationId}`, 'true'); } catch { /* ignore */ }
            setDashToast('Thank you! Your testimonial has been submitted for review.');
            setTimeout(() => setDashToast(''), 4000);
          }}
        />
      )}

      {/* ── Avatar preview modal ─────────────────────────────────────────────── */}
      {avatarPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={cancelAvatarPreview}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px 36px', maxWidth: 340, width: '90%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Preview Profile Photo</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 20 }}>Your photo will be cropped to a circle.</div>
            <div style={{ width: 120, height: 120, borderRadius: '50%', overflow: 'hidden', margin: '0 auto 24px', border: '3px solid #E8F0FB' }}>
              <img src={avatarPreview.src} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={cancelAvatarPreview}
                style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmAvatarUpload}
                style={{ flex: 1, padding: '10px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Upload
              </button>
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
    </div>
  );
}
