'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ─── Lesson types ────────────────────────────────────────────────────────────

interface Lesson {
  id: string;
  title: string;
  youtube_url: string;
  description: string;
  file_url: string | null;
  duration_minutes: number;
  display_order: number;
}

// ─── Assessment types ─────────────────────────────────────────────────────────

interface QuestionOption {
  id?: string;
  text: string;
  is_correct: boolean;
}

interface AssessmentQuestion {
  id: string;
  question: string;
  options: QuestionOption[];
  explanation: string;
  points: number;
  display_order: number;
}

interface Assessment {
  id: string;
  course_id: string;
  title: string;
  description: string;
  pass_score: number;
  time_limit: number | null;
  max_attempts: number;
  visible: boolean;
  assessment_questions: AssessmentQuestion[];
}

interface AssessmentAttempt {
  id: string;
  user_name: string;
  user_email: string;
  score: number;
  passed: boolean;
  created_at: string;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  background: '#FFFBEB',
  fontFamily: 'Inter, sans-serif',
  color: '#374151',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#374151',
  display: 'block',
  marginBottom: 6,
  textTransform: 'uppercase',
};

const primaryBtn: React.CSSProperties = {
  background: '#1B4F8A',
  color: '#fff',
  border: 'none',
  borderRadius: 7,
  padding: '9px 20px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '9px 20px',
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
  color: '#374151',
};

// ─── YouTube helper ───────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Default question form state ──────────────────────────────────────────────

const defaultQuestionForm = () => ({
  question: '',
  options: [
    { text: '', is_correct: true },
    { text: '', is_correct: false },
    { text: '', is_correct: false },
    { text: '', is_correct: false },
  ] as QuestionOption[],
  explanation: '',
  points: 1,
  display_order: 1,
});

// ─── Main page component ──────────────────────────────────────────────────────

export default function AdminCourseLessonsPage() {
  const { courseId } = useParams<{ courseId: string }>();

  // ─── Session Link types ───────────────────────────────────────────────────────

  // Shared state
  const [course, setCourse] = useState<{ title?: string; category?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'lessons' | 'assessment'>('lessons');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // ── Lesson state ────────────────────────────────────────────────────────────
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [editLesson, setEditLesson] = useState<Lesson | null>(null);
  const [lessonForm, setLessonForm] = useState({
    title: '',
    youtube_url: '',
    description: '',
    file_url: '',
    duration_minutes: 0,
    display_order: 1,
  });
  const [ytThumb, setYtThumb] = useState<string | null>(null);
  const [ytError, setYtError] = useState('');
  const [savingLesson, setSavingLesson] = useState(false);

  // ── Assessment state ────────────────────────────────────────────────────────
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentSettings, setAssessmentSettings] = useState({
    title: '',
    description: '',
    pass_score: 70,
    time_limit: '' as string, // stored as string for input; convert to number|null on save
    max_attempts: 3,
    visible: true,
  });
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    pass_score: 70,
    time_limit: '' as string,
    max_attempts: 3,
    visible: true,
  });
  const [creatingAssessment, setCreatingAssessment] = useState(false);

  // Question modal
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editQuestion, setEditQuestion] = useState<AssessmentQuestion | null>(null);
  const [questionForm, setQuestionForm] = useState(defaultQuestionForm());
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Attempts
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const [attempts, setAttempts] = useState<AssessmentAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const [expandedLesson, setExpandedLesson] = useState<string | null>(null);

  // ── Session Links state ──────────────────────────────────────────────────────
  interface SessionLink {
    tabKey: string; num: number; sessionName: string; isFinal: boolean;
    formUrl: string; youtubeUrl: string; videoDuration: number; hasForm: boolean;
  }
  const [sessionLinks, setSessionLinks] = useState<SessionLink[]>([]);
  const [sessionLinksLoading, setSessionLinksLoading] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [editSessionLink, setEditSessionLink] = useState<SessionLink | null>(null);
  const [sessionLinkForm, setSessionLinkForm] = useState({ youtubeUrl: '', videoDuration: 0 });
  const [savingSessionLink, setSavingSessionLink] = useState(false);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const fetchCourseData = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/training?courseId=${courseId}`)
      .then(r => r.json())
      .then(j => {
        setCourse(j.course);
        setLessons(j.lessons ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [courseId]);

  const fetchAssessment = useCallback(() => {
    setAssessmentLoading(true);
    fetch(`/api/admin/assessments?courseId=${courseId}`)
      .then(r => r.json())
      .then(data => {
        const a: Assessment | null = data ?? null;
        setAssessment(a);
        if (a) {
          setAssessmentSettings({
            title: a.title,
            description: a.description,
            pass_score: a.pass_score,
            time_limit: a.time_limit != null ? String(a.time_limit) : '',
            max_attempts: a.max_attempts,
            visible: a.visible,
          });
        }
        setAssessmentLoading(false);
      })
      .catch(() => setAssessmentLoading(false));
  }, [courseId]);

  const fetchAttempts = useCallback(() => {
    if (!assessment) return;
    setAttemptsLoading(true);
    fetch(`/api/admin/assessments/attempts?assessmentId=${assessment.id}`)
      .then(r => r.json())
      .then(data => { setAttempts(Array.isArray(data) ? data : []); setAttemptsLoading(false); })
      .catch(() => setAttemptsLoading(false));
  }, [assessment]);

  useEffect(() => { fetchCourseData(); }, [fetchCourseData]);

  useEffect(() => {
    if (activeTab === 'assessment') fetchAssessment();
  }, [activeTab, fetchAssessment]);

  useEffect(() => {
    if (attemptsOpen && assessment) fetchAttempts();
  }, [attemptsOpen, fetchAttempts, assessment]);

  // ── Lesson handlers ─────────────────────────────────────────────────────────

  async function checkYouTube(url: string) {
    setYtThumb(null);
    setYtError('');
    if (!url) return;
    const id = extractYouTubeId(url);
    if (!id) { setYtError('Invalid YouTube URL'); return; }
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${id}&format=json`);
      if (res.ok) { const data = await res.json(); setYtThumb(data.thumbnail_url); }
      else setYtError('Could not load video info');
    } catch {
      setYtThumb(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
    }
  }

  function openNewLesson() {
    setEditLesson(null);
    setLessonForm({ title: '', youtube_url: '', description: '', file_url: '', duration_minutes: 0, display_order: lessons.length + 1 });
    setYtThumb(null);
    setYtError('');
    setShowLessonForm(true);
  }

  function openEditLesson(l: Lesson) {
    setEditLesson(l);
    // Pre-fill YouTube URL and duration from Apps Script session link if not set on lesson
    const matchingLink = sessionLinks.find(s => s.num === l.display_order);
    const ytUrl = l.youtube_url || matchingLink?.youtubeUrl || '';
    const dur   = l.duration_minutes > 0 ? l.duration_minutes : (matchingLink?.videoDuration ?? 0);
    setLessonForm({ title: l.title, youtube_url: ytUrl, description: l.description, file_url: l.file_url ?? '', duration_minutes: dur, display_order: l.display_order });
    setYtThumb(null);
    setYtError('');
    if (ytUrl) checkYouTube(ytUrl);
    setShowLessonForm(true);
  }

  async function saveLesson() {
    setSavingLesson(true);
    try {
      const method = editLesson ? 'PATCH' : 'POST';
      const body = editLesson
        ? { ...lessonForm, id: editLesson.id, courseId }
        : { ...lessonForm, courseId };
      const res = await fetch(`/api/admin/training/${courseId}/lessons`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setShowLessonForm(false);
      fetchCourseData();
      showToast(editLesson ? 'Lesson updated' : 'Lesson added');
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSavingLesson(false);
    }
  }

  async function deleteLesson(id: string) {
    if (!confirm('Delete this lesson?')) return;
    try {
      await fetch(`/api/admin/training/${courseId}/lessons?id=${id}`, { method: 'DELETE' });
      fetchCourseData();
      showToast('Lesson deleted');
    } catch {
      showToast('Delete failed', 'error');
    }
  }

  // ── Assessment handlers ─────────────────────────────────────────────────────

  async function createAssessment() {
    setCreatingAssessment(true);
    try {
      const body = {
        courseId,
        title: createForm.title,
        description: createForm.description,
        pass_score: createForm.pass_score,
        time_limit: createForm.time_limit !== '' ? Number(createForm.time_limit) : null,
        max_attempts: createForm.max_attempts,
        visible: createForm.visible,
      };
      const res = await fetch('/api/admin/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      showToast('Assessment created');
      fetchAssessment();
    } catch {
      showToast('Create failed', 'error');
    } finally {
      setCreatingAssessment(false);
    }
  }

  async function saveAssessmentSettings() {
    if (!assessment) return;
    setSavingAssessment(true);
    try {
      const body = {
        id: assessment.id,
        title: assessmentSettings.title,
        description: assessmentSettings.description,
        pass_score: assessmentSettings.pass_score,
        time_limit: assessmentSettings.time_limit !== '' ? Number(assessmentSettings.time_limit) : null,
        max_attempts: assessmentSettings.max_attempts,
        visible: assessmentSettings.visible,
      };
      const res = await fetch('/api/admin/assessments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      showToast('Settings saved');
      fetchAssessment();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSavingAssessment(false);
    }
  }

  function openNewQuestion() {
    setEditQuestion(null);
    const order = assessment ? assessment.assessment_questions.length + 1 : 1;
    setQuestionForm({ ...defaultQuestionForm(), display_order: order });
    setShowQuestionModal(true);
  }

  function openEditQuestion(q: AssessmentQuestion) {
    setEditQuestion(q);
    // Ensure exactly 4 options
    const opts = [...q.options];
    while (opts.length < 4) opts.push({ text: '', is_correct: false });
    setQuestionForm({
      question: q.question,
      options: opts.slice(0, 4),
      explanation: q.explanation,
      points: q.points,
      display_order: q.display_order,
    });
    setShowQuestionModal(true);
  }

  function setCorrectOption(index: number) {
    setQuestionForm(prev => ({
      ...prev,
      options: prev.options.map((o, i) => ({ ...o, is_correct: i === index })),
    }));
  }

  function setOptionText(index: number, text: string) {
    setQuestionForm(prev => ({
      ...prev,
      options: prev.options.map((o, i) => i === index ? { ...o, text } : o),
    }));
  }

  async function saveQuestion() {
    if (!assessment) return;
    setSavingQuestion(true);
    try {
      const method = editQuestion ? 'PATCH' : 'POST';
      const body = editQuestion
        ? {
            id: editQuestion.id,
            question: questionForm.question,
            options: questionForm.options,
            explanation: questionForm.explanation,
            points: questionForm.points,
            display_order: questionForm.display_order,
          }
        : {
            assessment_id: assessment.id,
            question: questionForm.question,
            options: questionForm.options,
            explanation: questionForm.explanation,
            points: questionForm.points,
            display_order: questionForm.display_order,
          };
      const res = await fetch('/api/admin/assessments/questions', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setShowQuestionModal(false);
      showToast(editQuestion ? 'Question updated' : 'Question added');
      fetchAssessment();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSavingQuestion(false);
    }
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    try {
      const res = await fetch(`/api/admin/assessments/questions?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Question deleted');
      fetchAssessment();
    } catch {
      showToast('Delete failed', 'error');
    }
  }

  // ── Session Link handlers ───────────────────────────────────────────────────

  const fetchSessionLinks = useCallback(async (bust = false) => {
    if (!course?.category) return;
    setSessionLinksLoading(true);
    try {
      const url = `/api/training/course-details?bust=1${bust ? '&_t=' + Date.now() : ''}`;
      const res  = await fetch(url);
      const data = await res.json() as { sessions: (SessionLink & { course: string })[] };
      const filtered = (data.sessions ?? []).filter(
        s => s.course?.toUpperCase() === course.category?.toUpperCase(),
      );
      setSessionLinks(filtered.map(s => ({
        tabKey:        s.tabKey,
        num:           s.num,
        sessionName:   s.sessionName,
        isFinal:       s.isFinal,
        formUrl:       s.formUrl ?? '',
        youtubeUrl:    s.youtubeUrl ?? '',
        videoDuration: s.videoDuration ?? 0,
        hasForm:       s.hasForm,
      })));
    } catch {
      showToast('Failed to sync from Apps Script', 'error');
    } finally {
      setSessionLinksLoading(false);
    }
  }, [course?.category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'lessons' && course?.category) fetchSessionLinks();
  }, [activeTab, course?.category, fetchSessionLinks]);

  async function saveSessionLink() {
    if (!editSessionLink) return;
    setSavingSessionLink(true);
    try {
      const res = await fetch('/api/training/course-details', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tabKey:        editSessionLink.tabKey,
          youtubeUrl:    sessionLinkForm.youtubeUrl,
          videoDuration: sessionLinkForm.videoDuration,
        }),
      });
      const data = await res.json() as { ok: boolean };
      if (!data.ok) throw new Error('save failed');
      setShowSessionModal(false);
      showToast('Session link saved');
      fetchSessionLinks(true);
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSavingSessionLink(false);
    }
  }

  function openEditSessionLink(s: SessionLink) {
    setEditSessionLink(s);
    setSessionLinkForm({ youtubeUrl: s.youtubeUrl, videoDuration: s.videoDuration });
    setShowSessionModal(true);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const optionLabels = ['A', 'B', 'C', 'D'];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Back link */}
        <Link href="/admin/training" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}>
          ← Back to Courses
        </Link>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{course?.title ?? 'Course'}</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{lessons.length} lesson{lessons.length !== 1 ? 's' : ''}</p>
          </div>
          {activeTab === 'lessons' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => fetchSessionLinks(true)}
                disabled={sessionLinksLoading}
                style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {sessionLinksLoading ? '⟳ Syncing…' : '⟳ Sync from Apps Script'}
              </button>
              <button onClick={openNewLesson} style={primaryBtn}>+ Add Lesson</button>
            </div>
          )}
          {activeTab === 'assessment' && assessment && (
            <button onClick={openNewQuestion} style={primaryBtn}>+ Add Question</button>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB', marginBottom: 28 }}>
          {(['lessons', 'assessment'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #1B4F8A' : '2px solid transparent',
                color: activeTab === tab ? '#1B3A6B' : '#6B7280',
                fontWeight: activeTab === tab ? 700 : 400,
                fontSize: 14,
                padding: '8px 20px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: -1,
                transition: 'color 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {tab === 'lessons' ? 'Lessons' : 'Assessment'}
            </button>
          ))}
        </div>

        {/* ── LESSONS TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'lessons' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {lessons.length === 0 && (
                  <div style={{ background: '#fff', border: '1px dashed #D1D5DB', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6B7280' }}>
                    No lessons yet. Click &quot;+ Add Lesson&quot; to add the first one.
                  </div>
                )}
                {lessons.map(l => {
                  const link = sessionLinks.find(s => s.num === l.display_order);
                  const displayYtUrl  = l.youtube_url || link?.youtubeUrl || '';
                  const displayDuration = l.duration_minutes > 0 ? l.duration_minutes : (link?.videoDuration ?? 0);
                  const ytId = displayYtUrl ? extractYouTubeId(displayYtUrl) : null;
                  const isExpanded = expandedLesson === l.id;
                  return (
                    <div key={l.id} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ fontSize: 14, color: '#9CA3AF', width: 24, textAlign: 'center', flexShrink: 0 }}>{l.display_order}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1B3A6B', marginBottom: 4 }}>{l.title}</div>
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: displayDuration > 0 ? '#374151' : '#D1D5DB' }}>
                              ⏱ {displayDuration > 0 ? `${displayDuration} min` : '— min'}
                              {!l.duration_minutes && link?.videoDuration ? <span style={{ fontSize: 10, color: '#9CA3AF' }}> (from registry)</span> : null}
                            </span>
                            {displayYtUrl ? (
                              <a href={displayYtUrl} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12, color: '#DC2626', fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                                ▶ {displayYtUrl.replace('https://www.youtube.com/watch?v=', 'yt/').replace('https://youtu.be/', 'yt/').slice(0, 24)}
                                {!l.youtube_url && link?.youtubeUrl ? <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}> (registry)</span> : null}
                              </a>
                            ) : (
                              <span style={{ fontSize: 12, color: '#D1D5DB' }}>No video</span>
                            )}
                            {link?.formUrl && (
                              <a href={link.formUrl} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 11, color: '#1B4F8A', textDecoration: 'none', border: '1px solid #C7D9F2', borderRadius: 4, padding: '1px 7px' }}>
                                Form ↗
                              </a>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          {ytId && (
                            <button
                              onClick={() => setExpandedLesson(isExpanded ? null : l.id)}
                              style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 5, cursor: 'pointer', padding: '4px 10px' }}>
                              {isExpanded ? '▲ Hide' : '▶ Preview'}
                            </button>
                          )}
                          <button onClick={() => openEditLesson(l)} style={{ fontSize: 12, color: '#1B4F8A', background: 'none', border: '1px solid #C7D9F2', borderRadius: 5, cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}>Edit</button>
                          <button onClick={() => deleteLesson(l.id)} style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 5, cursor: 'pointer', padding: '4px 10px' }}>Delete</button>
                        </div>
                      </div>
                      {isExpanded && ytId && (
                        <div style={{ borderTop: '1px solid #E8F0FB', background: '#000', lineHeight: 0 }}>
                          <iframe
                            src={`https://www.youtube.com/embed/${ytId}`}
                            width="100%" height="260" style={{ border: 'none', display: 'block' }}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── ASSESSMENT TAB ────────────────────────────────────────────────── */}
        {activeTab === 'assessment' && (
          <>
            {assessmentLoading ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading…</div>
            ) : assessment === null ? (
              /* ── Create assessment form ── */
              <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 32, maxWidth: 600 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 20 }}>Create Assessment</h2>
                <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>No assessment exists for this course yet. Fill in the details below to create one.</p>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Title</label>
                  <input value={createForm.title} onChange={e => setCreateForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="e.g. Module 1 Assessment" />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Description</label>
                  <textarea value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>Pass Score %</label>
                    <input type="number" min={0} max={100} value={createForm.pass_score} onChange={e => setCreateForm(p => ({ ...p, pass_score: parseInt(e.target.value) || 0 }))} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Time Limit (min)</label>
                    <input type="number" min={0} value={createForm.time_limit} onChange={e => setCreateForm(p => ({ ...p, time_limit: e.target.value }))} placeholder="Unlimited" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Max Attempts</label>
                    <input type="number" min={1} value={createForm.max_attempts} onChange={e => setCreateForm(p => ({ ...p, max_attempts: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                  </div>
                </div>
                <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="create-visible" checked={createForm.visible} onChange={e => setCreateForm(p => ({ ...p, visible: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="create-visible" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>Visible to students</label>
                </div>
                <button onClick={createAssessment} disabled={creatingAssessment || !createForm.title} style={{ ...primaryBtn, opacity: !createForm.title ? 0.5 : 1 }}>
                  {creatingAssessment ? 'Creating…' : 'Create Assessment'}
                </button>
              </div>
            ) : (
              /* ── Assessment exists ── */
              <>
                {/* Settings panel */}
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28, marginBottom: 24 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 20 }}>Assessment Settings</h2>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Title</label>
                    <input value={assessmentSettings.title} onChange={e => setAssessmentSettings(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Description</label>
                    <textarea value={assessmentSettings.description} onChange={e => setAssessmentSettings(p => ({ ...p, description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Pass Score %</label>
                      <input type="number" min={0} max={100} value={assessmentSettings.pass_score} onChange={e => setAssessmentSettings(p => ({ ...p, pass_score: parseInt(e.target.value) || 0 }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Time Limit (min)</label>
                      <input type="number" min={0} value={assessmentSettings.time_limit} onChange={e => setAssessmentSettings(p => ({ ...p, time_limit: e.target.value }))} placeholder="Unlimited" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Max Attempts</label>
                      <input type="number" min={1} value={assessmentSettings.max_attempts} onChange={e => setAssessmentSettings(p => ({ ...p, max_attempts: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" id="edit-visible" checked={assessmentSettings.visible} onChange={e => setAssessmentSettings(p => ({ ...p, visible: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <label htmlFor="edit-visible" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>Visible to students</label>
                  </div>
                  <button onClick={saveAssessmentSettings} disabled={savingAssessment} style={primaryBtn}>
                    {savingAssessment ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>

                {/* Questions list */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B' }}>
                      Questions ({assessment.assessment_questions.length})
                    </h2>
                    <button onClick={openNewQuestion} style={primaryBtn}>+ Add Question</button>
                  </div>

                  {assessment.assessment_questions.length === 0 ? (
                    <div style={{ background: '#fff', border: '1px dashed #D1D5DB', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6B7280' }}>
                      No questions yet. Click &quot;+ Add Question&quot; to add the first one.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {assessment.assessment_questions
                        .slice()
                        .sort((a, b) => a.display_order - b.display_order)
                        .map((q, qi) => (
                          <div key={q.id} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '18px 20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1 }}>
                                <span style={{ fontSize: 12, color: '#9CA3AF', minWidth: 24, paddingTop: 2 }}>Q{qi + 1}</span>
                                <div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1B3A6B', marginBottom: 2 }}>{q.question}</div>
                                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>{q.points} pt{q.points !== 1 ? 's' : ''} · Order {q.display_order}</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                                <button onClick={() => openEditQuestion(q)} style={{ fontSize: 12, color: '#1B4F8A', background: 'none', border: '1px solid #C7D9F2', borderRadius: 5, cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}>Edit</button>
                                <button onClick={() => deleteQuestion(q.id)} style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 5, cursor: 'pointer', padding: '4px 10px' }}>Delete</button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 36 }}>
                              {q.options.map((opt, oi) => (
                                <div
                                  key={oi}
                                  style={{
                                    padding: '6px 10px',
                                    borderRadius: 6,
                                    fontSize: 13,
                                    border: opt.is_correct ? '1px solid #6EE7B7' : '1px solid #E5E7EB',
                                    background: opt.is_correct ? '#ECFDF5' : '#FAFAFA',
                                    color: opt.is_correct ? '#065F46' : '#374151',
                                    display: 'flex',
                                    gap: 8,
                                  }}
                                >
                                  <span style={{ fontWeight: 700, opacity: 0.6 }}>{optionLabels[oi]}.</span>
                                  <span>{opt.text}</span>
                                  {opt.is_correct && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#059669' }}>✓ Correct</span>}
                                </div>
                              ))}
                            </div>
                            {q.explanation && (
                              <div style={{ marginTop: 10, marginLeft: 36, fontSize: 12, color: '#6B7280', fontStyle: 'italic' }}>
                                Explanation: {q.explanation}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Attempts collapsible */}
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
                  <button
                    onClick={() => setAttemptsOpen(p => !p)}
                    style={{ width: '100%', background: 'none', border: 'none', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B' }}>Student Attempts</span>
                    <span style={{ fontSize: 16, color: '#6B7280', transition: 'transform 0.2s', display: 'inline-block', transform: attemptsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {attemptsOpen && (
                    <div style={{ padding: '0 20px 20px' }}>
                      {attemptsLoading ? (
                        <div style={{ padding: 24, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Loading…</div>
                      ) : attempts.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No attempts yet.</div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #E8F0FB' }}>
                              {['User Name', 'Email', 'Score', 'Passed', 'Date'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {attempts.map(a => (
                              <tr key={a.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                                <td style={{ padding: '8px 10px', color: '#1B3A6B', fontWeight: 600 }}>{a.user_name}</td>
                                <td style={{ padding: '8px 10px', color: '#6B7280' }}>{a.user_email}</td>
                                <td style={{ padding: '8px 10px', color: '#374151' }}>{a.score}%</td>
                                <td style={{ padding: '8px 10px' }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: a.passed ? '#ECFDF5' : '#FEF2F2', color: a.passed ? '#065F46' : '#991B1B' }}>
                                    {a.passed ? 'Passed' : 'Failed'}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 10px', color: '#9CA3AF' }}>{new Date(a.created_at).toLocaleDateString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* ── Lesson Form Modal ────────────────────────────────────────────────── */}
      {showLessonForm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: 20 }}
          onClick={() => setShowLessonForm(false)}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, width: 560, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>{editLesson ? 'Edit Lesson' : 'Add Lesson'}</h2>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Lesson Title</label>
              <input value={lessonForm.title} onChange={e => setLessonForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>YouTube URL</label>
              <input value={lessonForm.youtube_url} onChange={e => setLessonForm(p => ({ ...p, youtube_url: e.target.value }))} onBlur={e => checkYouTube(e.target.value)} placeholder="https://youtube.com/watch?v=…" style={inputStyle} />
              {ytError && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>⚠ {ytError}</div>}
              {ytThumb && <img src={ytThumb} alt="Video thumbnail" style={{ marginTop: 8, width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 6 }} />}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Description</label>
              <textarea value={lessonForm.description} onChange={e => setLessonForm(p => ({ ...p, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Download File URL <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(optional — Excel, PDF, etc.)</span></label>
              <input value={lessonForm.file_url} onChange={e => setLessonForm(p => ({ ...p, file_url: e.target.value }))} placeholder="https://… (leave blank if no file)" style={inputStyle} />
              {lessonForm.file_url && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#1A7A30' }}>
                  📎 File set — students will see a download button on this lesson
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={labelStyle}>Duration (minutes)</label>
                <input type="number" value={lessonForm.duration_minutes} onChange={e => setLessonForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Display Order</label>
                <input type="number" value={lessonForm.display_order} onChange={e => setLessonForm(p => ({ ...p, display_order: parseInt(e.target.value) || 1 }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowLessonForm(false)} style={ghostBtn}>Cancel</button>
              <button onClick={saveLesson} disabled={savingLesson} style={primaryBtn}>{savingLesson ? 'Saving…' : 'Save Lesson'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Question Form Modal ──────────────────────────────────────────────── */}
      {showQuestionModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: 20 }}
          onClick={() => setShowQuestionModal(false)}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, width: 620, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>{editQuestion ? 'Edit Question' : 'Add Question'}</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Question Text</label>
              <textarea value={questionForm.question} onChange={e => setQuestionForm(p => ({ ...p, question: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Options (select the correct answer)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questionForm.options.map((opt, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="radio"
                      name="correct-option"
                      checked={opt.is_correct}
                      onChange={() => setCorrectOption(i)}
                      style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      title="Mark as correct"
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', width: 20, flexShrink: 0 }}>{optionLabels[i]}.</span>
                    <input
                      value={opt.text}
                      onChange={e => setOptionText(i, e.target.value)}
                      placeholder={`Option ${optionLabels[i]}`}
                      style={{
                        ...inputStyle,
                        border: opt.is_correct ? '1px solid #6EE7B7' : '1px solid #D1D5DB',
                        background: opt.is_correct ? '#ECFDF5' : '#FFFBEB',
                      }}
                    />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>Click the radio button to the left to mark an option as correct.</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Explanation (shown after attempt)</label>
              <textarea value={questionForm.explanation} onChange={e => setQuestionForm(p => ({ ...p, explanation: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional explanation shown to students after submitting" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={labelStyle}>Points</label>
                <input type="number" min={1} value={questionForm.points} onChange={e => setQuestionForm(p => ({ ...p, points: parseInt(e.target.value) || 1 }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Display Order</label>
                <input type="number" min={1} value={questionForm.display_order} onChange={e => setQuestionForm(p => ({ ...p, display_order: parseInt(e.target.value) || 1 }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowQuestionModal(false)} style={ghostBtn}>Cancel</button>
              <button onClick={saveQuestion} disabled={savingQuestion} style={primaryBtn}>{savingQuestion ? 'Saving…' : editQuestion ? 'Update Question' : 'Add Question'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Link Edit Modal ──────────────────────────────────────────── */}
      {showSessionModal && editSessionLink && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: 20 }}
          onClick={() => setShowSessionModal(false)}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, width: 520, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Edit Session Link</h2>
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 24 }}>{editSessionLink.tabKey}</p>

            {/* Session Name (read-only) */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Session Name</label>
              <div style={{ padding: '8px 12px', background: '#F3F4F6', borderRadius: 7, fontSize: 13, color: '#6B7280', border: '1px solid #E5E7EB' }}>
                {editSessionLink.sessionName}
                {editSessionLink.isFinal && <span style={{ marginLeft: 8, fontSize: 10, background: '#FEF9C3', color: '#854D0E', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>FINAL</span>}
              </div>
            </div>

            {/* YouTube URL */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>YouTube URL</label>
              <input
                value={sessionLinkForm.youtubeUrl}
                onChange={e => setSessionLinkForm(p => ({ ...p, youtubeUrl: e.target.value }))}
                placeholder="https://www.youtube.com/watch?v=…"
                style={inputStyle}
              />
            </div>

            {/* Video Duration */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Video Duration (minutes) <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>— 0 = no lock</span></label>
              <input
                type="number"
                min={0}
                value={sessionLinkForm.videoDuration}
                onChange={e => setSessionLinkForm(p => ({ ...p, videoDuration: parseInt(e.target.value) || 0 }))}
                style={inputStyle}
              />
              {sessionLinkForm.videoDuration > 0 && (
                <div style={{ fontSize: 11, color: '#D97706', marginTop: 4 }}>
                  ⏱ Assessment will be locked for {sessionLinkForm.videoDuration} min after student clicks Watch Video
                </div>
              )}
            </div>

            {/* Form URL (read-only) */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Form URL <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(read-only — synced from Apps Script)</span></label>
              {editSessionLink.formUrl ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, padding: '8px 12px', background: '#F3F4F6', borderRadius: 7, fontSize: 12, color: '#6B7280', border: '1px solid #E5E7EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {editSessionLink.formUrl}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(editSessionLink.formUrl).then(() => showToast('Copied'), () => showToast('Copy failed', 'error'))}
                    style={{ ...ghostBtn, padding: '8px 14px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
                  >Copy</button>
                </div>
              ) : (
                <div style={{ padding: '8px 12px', background: '#F3F4F6', borderRadius: 7, fontSize: 13, color: '#D1D5DB', border: '1px solid #E5E7EB' }}>No form URL</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSessionModal(false)} style={ghostBtn}>Cancel</button>
              <button onClick={saveSessionLink} disabled={savingSessionLink} style={primaryBtn}>{savingSessionLink ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
