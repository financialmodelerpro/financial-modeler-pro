'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { extractYouTubeId } from '@/src/shared/cms';
import { adminFetchJson } from '@/src/components/admin/adminFetch';

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

// ─── Main page component ──────────────────────────────────────────────────────

export default function AdminCourseLessonsPage() {
  const { courseId } = useParams<{ courseId: string }>();

  // ─── Session Link types ───────────────────────────────────────────────────────

  // Shared state
  const [course, setCourse] = useState<{ title?: string; category?: string } | null>(null);
  const [loading, setLoading] = useState(true);
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

  // ── Attachments state ───────────────────────────────────────────────────────
  interface Attachment { id: string; tab_key: string; course: string; file_name: string; file_url: string; file_type: string; file_size: number; is_visible: boolean; uploaded_at: string }
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState<string | null>(null);

  async function loadAttachments(tabKey: string) {
    try {
      const res = await fetch(`/api/admin/attachments?tabKey=${encodeURIComponent(tabKey)}`);
      const d = await res.json() as { attachments?: Attachment[] };
      setAttachments(prev => ({ ...prev, [tabKey]: d.attachments ?? [] }));
    } catch { /* ignore */ }
  }

  async function uploadAttachment(tabKey: string, file: File) {
    // Use the loaded course's category (3SFM / BVM) instead of the URL
    // slug. The page is reached via /admin/training/<UUID> (links from
    // the course list use c.id), so courseId is the course's UUID, not
    // the short code. Comparing it to the literal 'bvm' / '3sfm' was
    // always false, which silently routed every BVM upload to the
    // 3SFM bucket and overwrote real 3SFM session attachments
    // (root cause of the cross-course mixing reported 2026-04-23).
    const category = (course?.category ?? '').toUpperCase();
    if (category !== 'BVM' && category !== '3SFM') {
      // Course data hasn't arrived yet (or this is an unsupported
      // course). Refuse to upload rather than fall back to a default
      // that would write the wrong bucket. The Upload buttons below
      // are also disabled while course is null, so this is a final
      // safety net.
      setToast({ msg: 'Course data still loading - try again in a moment.', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const code = category.toLowerCase();
    setUploadingFor(tabKey);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tabKey', tabKey);
      fd.append('course', code);
      const res = await fetch('/api/admin/attachments', { method: 'POST', body: fd });
      const d = await res.json() as { success?: boolean; attachment?: Attachment; error?: string };
      if (d.success && d.attachment) {
        setAttachments(prev => ({ ...prev, [tabKey]: [...(prev[tabKey] ?? []), d.attachment!] }));
        setToast({ msg: 'File uploaded', type: 'success' });
        setTimeout(() => setToast(null), 2000);
      } else {
        setToast({ msg: d.error ?? 'Upload failed', type: 'error' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch { setToast({ msg: 'Upload failed', type: 'error' }); setTimeout(() => setToast(null), 3000); }
    setUploadingFor(null);
  }

  async function toggleAttachmentVisibility(tabKey: string, id: string, visible: boolean) {
    await fetch('/api/admin/attachments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_visible: visible }) });
    setAttachments(prev => ({ ...prev, [tabKey]: (prev[tabKey] ?? []).map(a => a.id === id ? { ...a, is_visible: visible } : a) }));
  }

  async function deleteAttachment(tabKey: string, id: string) {
    if (!confirm('Delete this attachment?')) return;
    await fetch('/api/admin/attachments', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setAttachments(prev => ({ ...prev, [tabKey]: (prev[tabKey] ?? []).filter(a => a.id !== id) }));
    setToast({ msg: 'Deleted', type: 'success' }); setTimeout(() => setToast(null), 2000);
  }

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
    adminFetchJson(`/api/admin/training?courseId=${courseId}`)
      .then(j => {
        setCourse(j.course);
        setLessons(j.lessons ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { fetchCourseData(); }, [fetchCourseData]);
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
    if (course?.category) fetchSessionLinks();
  }, [course?.category, fetchSessionLinks]);

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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Back link */}
        <Link href="/admin/training" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}>
          ← Back to Courses
        </Link>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{course?.title ?? 'Course'}</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{lessons.length} lesson{lessons.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <>
                <button
                  onClick={() => fetchSessionLinks(true)}
                  disabled={sessionLinksLoading}
                  style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {sessionLinksLoading ? '⟳ Syncing…' : '⟳ Sync from Apps Script'}
                </button>
                <button onClick={openNewLesson} style={primaryBtn}>+ Add Lesson</button>
              </>
          </div>
        </div>

        {/* Global shuffle + timer toggles moved to Training Settings, see note
            on the Course Manager overview. This page focuses on course structure. */}


        {/* ── LESSONS TAB ───────────────────────────────────────────────────── */}
          <>
            {/* Course-level attachments. Prefix derived from the loaded
                course.category (3SFM / BVM); see uploadAttachment for
                why we no longer trust the URL slug. */}
            {(() => {
              const courseCategory = (course?.category ?? '').toUpperCase() === 'BVM' ? 'BVM' : '3SFM';
              const courseTk = `${courseCategory}_COURSE`;
              const courseAtts = attachments[courseTk] ?? [];
              return (
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B' }}>Course Materials</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Files available to all students in this course</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={() => { if (!attachments[courseTk]) loadAttachments(courseTk); setAttachOpen(attachOpen === courseTk ? null : courseTk); }}
                        style={{ fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #D1D5DB', borderRadius: 5, cursor: 'pointer', padding: '5px 12px', fontWeight: 600 }}>
                        📎 {courseAtts.length ? `${courseAtts.length} files` : 'Manage'}
                      </button>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A', cursor: 'pointer', padding: '5px 12px', border: '1px solid #C7D9F2', borderRadius: 5, background: '#EFF6FF' }}>
                        {uploadingFor === courseTk ? 'Uploading...' : '+ Upload'}
                        <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingFor === courseTk}
                          onChange={e => { if (e.target.files?.[0]) uploadAttachment(courseTk, e.target.files[0]); e.target.value = ''; }} />
                      </label>
                    </div>
                  </div>
                  {attachOpen === courseTk && courseAtts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {courseAtts.map(att => (
                        <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#F9FAFB', borderRadius: 6, border: '1px solid #E5E7EB', opacity: att.is_visible ? 1 : 0.5 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>
                            {att.file_type === 'pdf' ? '📄' : att.file_type === 'docx' ? '📝' : att.file_type === 'pptx' ? '📊' : att.file_type === 'xlsx' ? '📗' : '🖼️'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <a href={att.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {att.file_name}
                            </a>
                            <span style={{ fontSize: 10, color: '#9CA3AF' }}>{att.file_type.toUpperCase()} - {att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</span>
                          </div>
                          <button onClick={() => toggleAttachmentVisibility(courseTk, att.id, !att.is_visible)}
                            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid #D1D5DB', background: att.is_visible ? '#F0FFF4' : '#F9FAFB', color: att.is_visible ? '#15803D' : '#9CA3AF', cursor: 'pointer' }}>
                            {att.is_visible ? 'Visible' : 'Hidden'}
                          </button>
                          <button onClick={() => deleteAttachment(courseTk, att.id)}
                            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {attachOpen === courseTk && courseAtts.length === 0 && (
                    <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 0' }}>No course-level materials yet. Click Upload to add files.</div>
                  )}
                </div>
              );
            })()}

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
                  // Prefix derived from course.category, not the URL
                  // slug (which is a UUID here, not '3sfm'/'bvm').
                  // The final lesson uses the canonical _Final suffix so
                  // attachments uploaded to it surface on the watch
                  // page (which builds the same key from session.isFinal).
                  const isBvm = (course?.category ?? '').toUpperCase() === 'BVM';
                  const maxOrder = lessons.reduce((m, x) => Math.max(m, x.display_order), 0);
                  const isFinal = l.display_order === maxOrder;
                  const tk = isFinal
                    ? `${isBvm ? 'BVM' : '3SFM'}_Final`
                    : `${isBvm ? 'BVM_L' : '3SFM_S'}${l.display_order}`;
                  const lessonAttachments = attachments[tk] ?? [];
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
                              ⏱ {displayDuration > 0 ? `${displayDuration} min` : '- min'}
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
                            {/* Form URL hidden from UI - stored in Apps Script Form Registry only */}
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
                          <button onClick={() => { setAttachOpen(attachOpen === tk ? null : tk); if (!attachments[tk]) loadAttachments(tk); }}
                            style={{ fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #D1D5DB', borderRadius: 5, cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}>
                            📎 {lessonAttachments.length || ''}
                          </button>
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
                      {/* Attachments panel */}
                      {attachOpen === tk && (
                        <div style={{ borderTop: '1px solid #E8F0FB', padding: '14px 20px', background: '#FAFBFC' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Attachments</span>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A', cursor: 'pointer', padding: '4px 10px', border: '1px solid #C7D9F2', borderRadius: 5, background: '#EFF6FF' }}>
                              {uploadingFor === tk ? 'Uploading...' : '+ Upload'}
                              <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingFor === tk}
                                onChange={e => { if (e.target.files?.[0]) uploadAttachment(tk, e.target.files[0]); e.target.value = ''; }} />
                            </label>
                          </div>
                          {lessonAttachments.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 0' }}>No attachments yet.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {lessonAttachments.map(att => (
                                <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#fff', borderRadius: 6, border: '1px solid #E5E7EB', opacity: att.is_visible ? 1 : 0.5 }}>
                                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                                    {att.file_type === 'pdf' ? '📄' : att.file_type === 'docx' ? '📝' : att.file_type === 'pptx' ? '📊' : att.file_type === 'xlsx' ? '📗' : '🖼️'}
                                  </span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <a href={att.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {att.file_name}
                                    </a>
                                    <span style={{ fontSize: 10, color: '#9CA3AF' }}>{att.file_type.toUpperCase()} - {att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</span>
                                  </div>
                                  <button onClick={() => toggleAttachmentVisibility(tk, att.id, !att.is_visible)}
                                    style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid #D1D5DB', background: att.is_visible ? '#F0FFF4' : '#F9FAFB', color: att.is_visible ? '#15803D' : '#9CA3AF', cursor: 'pointer' }}>
                                    {att.is_visible ? 'Visible' : 'Hidden'}
                                  </button>
                                  <button onClick={() => deleteAttachment(tk, att.id)}
                                    style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
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
              <label style={labelStyle}>Download File URL <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(optional - Excel, PDF, etc.)</span></label>
              <input value={lessonForm.file_url} onChange={e => setLessonForm(p => ({ ...p, file_url: e.target.value }))} placeholder="https://… (leave blank if no file)" style={inputStyle} />
              {lessonForm.file_url && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#1A7A30' }}>
                  📎 File set - students will see a download button on this lesson
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
              <label style={labelStyle}>Video Duration (minutes) <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>- 0 = no lock</span></label>
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

            {/* Form URL removed from UI - stored silently in Apps Script Form Registry */}

            {/* Reset watch progress, wipes all students' watch-history
                rows for this session. Use after swapping the YouTube
                URL so stale progress doesn't stick against the new
                video. (Per-student auto-detect on the watch endpoint
                already handles students who come back and re-play; this
                is the nuclear option for completed rows that won't get
                another tick.) */}
            <div style={{ marginBottom: 16, paddingTop: 16, borderTop: '1px dashed #E5E7EB' }}>
              <button
                type="button"
                onClick={async () => {
                  if (!editSessionLink) return;
                  if (!confirm(`Reset watch progress for EVERY student on "${editSessionLink.sessionName}"?\n\nThis deletes all stored watch_seconds / completed flags for this session. Students will need to re-watch to unlock the assessment.`)) return;
                  try {
                    const res = await fetch(`/api/admin/sessions/${encodeURIComponent(editSessionLink.tabKey)}/reset-watch-progress`, { method: 'POST' });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) { alert(j.error ?? 'Reset failed'); return; }
                    alert(`Reset ${j.deleted ?? 0} row(s).`);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Reset failed');
                  }
                }}
                style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                🔁 Reset watch progress for all students
              </button>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                Safe to use after swapping the YouTube URL. Existing rows get deleted, next tick rebuilds fresh from zero.
              </div>
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
