'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Lesson { id: string; title: string; youtube_url: string; description: string; file_url: string | null; duration_minutes: number; display_order: number }

function extractYouTubeId(url: string): string | null {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/, /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

export default function AdminCourseLessonsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<any>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editLesson, setEditLesson] = useState<Lesson | null>(null);
  const [form, setForm] = useState({ title: '', youtube_url: '', description: '', duration_minutes: 0, display_order: 1 });
  const [ytThumb, setYtThumb] = useState<string | null>(null);
  const [ytError, setYtError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/training?courseId=${courseId}`)
      .then(r => r.json())
      .then(j => { setCourse(j.course); setLessons(j.lessons ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function checkYouTube(url: string) {
    setYtThumb(null); setYtError('');
    if (!url) return;
    const id = extractYouTubeId(url);
    if (!id) { setYtError('Invalid YouTube URL'); return; }
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${id}&format=json`);
      if (res.ok) { const data = await res.json(); setYtThumb(data.thumbnail_url); }
      else setYtError('Could not load video info');
    } catch { setYtThumb(`https://img.youtube.com/vi/${id}/hqdefault.jpg`); }
  }

  function openNew() {
    setEditLesson(null);
    setForm({ title: '', youtube_url: '', description: '', duration_minutes: 0, display_order: lessons.length + 1 });
    setYtThumb(null); setYtError('');
    setShowForm(true);
  }

  function openEdit(l: Lesson) {
    setEditLesson(l);
    setForm({ title: l.title, youtube_url: l.youtube_url, description: l.description, duration_minutes: l.duration_minutes, display_order: l.display_order });
    setYtThumb(null); setYtError('');
    if (l.youtube_url) checkYouTube(l.youtube_url);
    setShowForm(true);
  }

  async function saveLesson() {
    setSaving(true);
    try {
      const method = editLesson ? 'PATCH' : 'POST';
      const body = editLesson ? { ...form, id: editLesson.id, courseId } : { ...form, courseId };
      const res = await fetch(`/api/admin/training/${courseId}/lessons`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      setShowForm(false); fetchData();
      setToast({ msg: editLesson ? 'Lesson updated' : 'Lesson added', type: 'success' }); setTimeout(() => setToast(null), 2500);
    } catch { setToast({ msg: 'Save failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    finally { setSaving(false); }
  }

  async function deleteLesson(id: string) {
    if (!confirm('Delete this lesson?')) return;
    try {
      await fetch(`/api/admin/training/${courseId}/lessons?id=${id}`, { method: 'DELETE' });
      fetchData();
      setToast({ msg: 'Lesson deleted', type: 'success' }); setTimeout(() => setToast(null), 2500);
    } catch { setToast({ msg: 'Delete failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <Link href="/admin/training" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}>← Back to Courses</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{course?.title ?? 'Course'}</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{lessons.length} lesson{lessons.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={openNew} style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Lesson
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lessons.length === 0 && (
              <div style={{ background: '#fff', border: '1px dashed #D1D5DB', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6B7280' }}>
                No lessons yet. Click &quot;+ Add Lesson&quot; to add the first one.
              </div>
            )}
            {lessons.map((l, i) => (
              <div key={l.id} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 14, color: '#9CA3AF', width: 24, textAlign: 'center' }}>{l.display_order}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1B3A6B', marginBottom: 2 }}>{l.title}</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>{l.duration_minutes} min · {l.youtube_url ? 'YouTube' : 'No video'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openEdit(l)} style={{ fontSize: 12, color: '#1B4F8A', background: 'none', border: '1px solid #C7D9F2', borderRadius: 5, cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}>Edit</button>
                  <button onClick={() => deleteLesson(l.id)} style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 5, cursor: 'pointer', padding: '4px 10px' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Lesson Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto', padding: 20 }} onClick={() => setShowForm(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, width: 560, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>{editLesson ? 'Edit Lesson' : 'Add Lesson'}</h2>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Lesson Title</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} /></div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>YouTube URL</label>
              <input value={form.youtube_url} onChange={e => { setForm(p => ({ ...p, youtube_url: e.target.value })); }} onBlur={e => checkYouTube(e.target.value)} placeholder="https://youtube.com/watch?v=…" style={inputStyle} />
              {ytError && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>⚠ {ytError}</div>}
              {ytThumb && <img src={ytThumb} alt="Video thumbnail" style={{ marginTop: 8, width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 6 }} />}
            </div>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Description</label><textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Duration (minutes)</label><input type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))} style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Display Order</label><input type="number" value={form.display_order} onChange={e => setForm(p => ({ ...p, display_order: parseInt(e.target.value) || 1 }))} style={inputStyle} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '9px 20px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveLesson} disabled={saving} style={{ padding: '9px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Lesson'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
