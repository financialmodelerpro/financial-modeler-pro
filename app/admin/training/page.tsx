'use client';

import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import Link from 'next/link';

interface Course { id: string; title: string; description: string; category: string; status: string; display_order: number; thumbnail_url: string | null; _lesson_count?: number }
interface Stats  { courses: number; lessons: number; enrollments: number | null; certificates: number | null }

export default function AdminTrainingPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState<Stats>({ courses: 0, lessons: 0, enrollments: null, certificates: null });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: 'General', thumbnail_url: '', status: 'draft' as 'draft' | 'published', display_order: 0 });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchCourses = () => {
    setLoading(true);
    fetch('/api/admin/training')
      .then(r => r.json())
      .then(j => {
        const courses: Course[] = j.courses ?? [];
        setCourses(courses);
        const totalLessons = courses.reduce((s, c) => s + (c._lesson_count ?? 0), 0);
        setStats(p => ({ ...p, courses: courses.length, lessons: totalLessons }));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const fetchAppsScriptStats = () => {
    // Enrollments: count students via Apps Script proxy
    fetch('/api/training?action=listStudents')
      .then(r => r.json())
      .then(j => {
        const count = Array.isArray(j.students) ? j.students.length : (j.total ?? null);
        setStats(p => ({ ...p, enrollments: count }));
      })
      .catch(() => setStats(p => ({ ...p, enrollments: null })));

    // Certificates: count from listCourses cert totals
    fetch('/api/training?action=listCourses')
      .then(r => r.json())
      .then(j => {
        const courses = Array.isArray(j.courses) ? j.courses : [];
        const total = courses.reduce((s: number, c: any) => s + (c.certificatesIssued ?? c.certificates_issued ?? 0), 0);
        setStats(p => ({ ...p, certificates: total }));
      })
      .catch(() => setStats(p => ({ ...p, certificates: null })));
  };

  useEffect(() => { fetchCourses(); fetchAppsScriptStats(); }, []);

  function openNew() {
    setEditCourse(null);
    setForm({ title: '', description: '', category: 'General', thumbnail_url: '', status: 'draft', display_order: courses.length + 1 });
    setShowModal(true);
  }

  function openEdit(c: Course) {
    setEditCourse(c);
    setForm({ title: c.title, description: c.description, category: c.category, thumbnail_url: c.thumbnail_url ?? '', status: c.status as any, display_order: c.display_order });
    setShowModal(true);
  }

  async function saveCourse() {
    setSaving(true);
    try {
      const method = editCourse ? 'PATCH' : 'POST';
      const body = editCourse ? { ...form, id: editCourse.id } : form;
      const res = await fetch('/api/admin/training', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      setShowModal(false);
      fetchCourses();
      setToast({ msg: editCourse ? 'Course updated' : 'Course created', type: 'success' });
      setTimeout(() => setToast(null), 2500);
    } catch { setToast({ msg: 'Save failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    finally { setSaving(false); }
  }

  async function deleteCourse(id: string) {
    if (!confirm('Delete this course and all its lessons?')) return;
    try {
      await fetch(`/api/admin/training?id=${id}`, { method: 'DELETE' });
      fetchCourses();
      setToast({ msg: 'Course deleted', type: 'success' }); setTimeout(() => setToast(null), 2500);
    } catch { setToast({ msg: 'Delete failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Training & Certification</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>Manage courses, lessons, enrollments and certificates</p>
          </div>
          <button onClick={openNew} style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Course
          </button>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Courses',      value: stats.courses,      icon: '🎓', color: '#1B4F8A', bg: '#E8F0FB' },
            { label: 'Total Lessons',      value: stats.lessons,      icon: '▶️', color: '#1A7A30', bg: '#E8F7EC' },
            { label: 'Enrollments',        value: stats.enrollments,  icon: '👥', color: '#92400E', bg: '#FEF3C7' },
            { label: 'Certs Issued',       value: stats.certificates, icon: '🏆', color: '#5B21B6', bg: '#F5F3FF' },
          ].map(k => (
            <div key={k.label} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{k.icon}</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{k.label}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: k.color }}>{k.value ?? '—'}</div>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>Courses</h2>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  {['#', 'Title', 'Category', 'Lessons', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courses.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: '#6B7280' }}>No courses yet. Click &quot;+ New Course&quot; to add one.</td></tr>
                ) : courses.map((c, i) => (
                  <tr key={c.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF', width: 40 }}>{c.display_order}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{c.description.substring(0, 60)}{c.description.length > 60 ? '…' : ''}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: '#E8F0FB', color: '#1B4F8A' }}>{c.category}</span></td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151', textAlign: 'center' }}>{c._lesson_count ?? 0}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: c.status === 'published' ? '#E8F7EC' : '#F3F4F6', color: c.status === 'published' ? '#1A7A30' : '#6B7280' }}>{c.status}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Link href={`/admin/training/${c.id}`} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Lessons</Link>
                        <span style={{ color: '#E5E7EB' }}>|</span>
                        <button onClick={() => openEdit(c)} style={{ fontSize: 12, color: '#374151', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Edit</button>
                        <span style={{ color: '#E5E7EB' }}>|</span>
                        <button onClick={() => deleteCourse(c.id)} style={{ fontSize: 12, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, width: 480, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>{editCourse ? 'Edit Course' : 'New Course'}</h2>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Title</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} /></div>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Description</label><textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Category</label><input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as any }))} style={{ ...inputStyle, cursor: 'pointer' }}><option value="draft">Draft</option><option value="published">Published</option></select></div>
            </div>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Thumbnail URL</label><input value={form.thumbnail_url} onChange={e => setForm(p => ({ ...p, thumbnail_url: e.target.value }))} placeholder="https://…" style={inputStyle} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '9px 20px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveCourse} disabled={saving} style={{ padding: '9px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Course'}</button>
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
