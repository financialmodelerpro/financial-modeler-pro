'use client';

import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import Link from 'next/link';

interface Course {
  id: string; title: string; description: string; category: string; status: string;
  display_order: number; thumbnail_url: string | null; _lesson_count?: number;
  tagline?: string; full_description?: string; what_you_learn?: string[];
  prerequisites?: string; who_is_this_for?: string; skill_level?: string;
  duration_hours?: number; language?: string; certificate_description?: string;
}
interface Stats  { courses: number; lessons: number; enrollments: number | null; certificates: number | null }

const EMPTY_BASIC = { title: '', description: '', category: 'General', thumbnail_url: '', status: 'draft' as 'draft' | 'published', display_order: 0 };
const EMPTY_DESC  = { tagline: '', full_description: '', what_you_learn: [] as string[], prerequisites: '', who_is_this_for: '', skill_level: 'Beginner' as 'Beginner' | 'Intermediate' | 'Advanced', duration_hours: '' as string | number, language: 'English', certificate_description: '' };

export default function AdminTrainingPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState<Stats>({ courses: 0, lessons: 0, enrollments: null, certificates: null });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalTab, setModalTab] = useState<'basic' | 'description'>('basic');
  const [editCourse, setEditCourse] = useState<Course | null>(null);
  const [form, setForm] = useState(EMPTY_BASIC);
  const [descForm, setDescForm] = useState(EMPTY_DESC);
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
    // Enrollments: count students via admin students API
    fetch('/api/admin/training-hub/students')
      .then(r => r.json())
      .then(j => {
        const count = Array.isArray(j.students) ? j.students.length : null;
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
    setModalTab('basic');
    setForm({ ...EMPTY_BASIC, display_order: courses.length + 1 });
    setDescForm(EMPTY_DESC);
    setShowModal(true);
  }

  function openEdit(c: Course) {
    setEditCourse(c);
    setModalTab('basic');
    setForm({ title: c.title, description: c.description, category: c.category, thumbnail_url: c.thumbnail_url ?? '', status: c.status as any, display_order: c.display_order });
    setDescForm({
      tagline:              c.tagline ?? '',
      full_description:     c.full_description ?? '',
      what_you_learn:       c.what_you_learn ?? [],
      prerequisites:        c.prerequisites ?? '',
      who_is_this_for:      c.who_is_this_for ?? '',
      skill_level:          (c.skill_level as any) ?? 'Beginner',
      duration_hours:       c.duration_hours ?? '',
      language:             c.language ?? 'English',
      certificate_description: c.certificate_description ?? '',
    });
    setShowModal(true);
  }

  async function saveCourse() {
    setSaving(true);
    try {
      const method = editCourse ? 'PATCH' : 'POST';
      const body = editCourse ? { ...form, ...descForm, id: editCourse.id } : form;
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

  const inputStyle: React.CSSProperties  = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties  = { fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const helperStyle: React.CSSProperties = { fontSize: 11, color: '#9CA3AF', margin: '0 0 6px' };

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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, width: 580, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ padding: '24px 28px 0', flexShrink: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 20 }}>{editCourse ? 'Edit Course' : 'New Course'}</h2>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '2px solid #E8F0FB', marginBottom: 0 }}>
                {(['basic', 'description'] as const).map(tab => (
                  <button key={tab} onClick={() => setModalTab(tab)} style={{
                    padding: '9px 18px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: 'none', borderBottom: modalTab === tab ? '2px solid #1B4F8A' : '2px solid transparent',
                    color: modalTab === tab ? '#1B4F8A' : '#6B7280', marginBottom: -2, textTransform: 'capitalize',
                  }}>
                    {tab === 'basic' ? 'Basic Info' : 'Description'}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
              {modalTab === 'basic' && (
                <>
                  <div style={{ marginBottom: 16 }}><label style={labelStyle}>Title</label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} /></div>
                  <div style={{ marginBottom: 16 }}><label style={labelStyle}>Short Description <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(shown in course list)</span></label><textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div><label style={labelStyle}>Category</label><input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as any }))} style={{ ...inputStyle, cursor: 'pointer' }}><option value="draft">Draft</option><option value="published">Published</option></select></div>
                  </div>
                  <div style={{ marginBottom: 16 }}><label style={labelStyle}>Thumbnail URL</label><input value={form.thumbnail_url} onChange={e => setForm(p => ({ ...p, thumbnail_url: e.target.value }))} placeholder="https://…" style={inputStyle} /></div>
                </>
              )}

              {modalTab === 'description' && (
                <>
                  {/* Tagline */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Course Tagline <span style={{ fontWeight: 400, color: '#9CA3AF' }}>({120 - (descForm.tagline?.length ?? 0)} chars left)</span></label>
                    <p style={helperStyle}>One-line hook shown below the course title</p>
                    <input value={descForm.tagline} onChange={e => setDescForm(p => ({ ...p, tagline: e.target.value.slice(0, 120) }))} style={inputStyle} placeholder="Master the complete 3-statement financial model…" />
                  </div>

                  {/* Full description */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Full Description <span style={{ fontWeight: 400, color: '#9CA3AF' }}>({800 - (descForm.full_description?.length ?? 0)} chars left)</span></label>
                    <p style={helperStyle}>2-3 paragraphs shown in course details</p>
                    <textarea value={descForm.full_description} onChange={e => setDescForm(p => ({ ...p, full_description: e.target.value.slice(0, 800) }))} rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>

                  {/* What You Will Learn */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>What You Will Learn</label>
                    <p style={helperStyle}>Each line = one learning outcome. Min 3, max 12 items.</p>
                    {descForm.what_you_learn.map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          value={item}
                          onChange={e => setDescForm(p => { const a = [...p.what_you_learn]; a[i] = e.target.value; return { ...p, what_you_learn: a }; })}
                          style={{ ...inputStyle, flex: 1 }}
                          placeholder={`Learning outcome ${i + 1}`}
                        />
                        <button
                          onClick={() => setDescForm(p => ({ ...p, what_you_learn: p.what_you_learn.filter((_, j) => j !== i) }))}
                          disabled={descForm.what_you_learn.length <= 3}
                          style={{ padding: '6px 12px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', fontSize: 12, cursor: descForm.what_you_learn.length <= 3 ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {descForm.what_you_learn.length < 12 && (
                      <button
                        onClick={() => setDescForm(p => ({ ...p, what_you_learn: [...p.what_you_learn, ''] }))}
                        style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
                      >
                        + Add Learning Outcome
                      </button>
                    )}
                  </div>

                  {/* Prerequisites + Who is this for */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Prerequisites</label>
                    <p style={helperStyle}>What students need to know before starting</p>
                    <textarea value={descForm.prerequisites} onChange={e => setDescForm(p => ({ ...p, prerequisites: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Who Is This For</label>
                    <p style={helperStyle}>Target audience description</p>
                    <textarea value={descForm.who_is_this_for} onChange={e => setDescForm(p => ({ ...p, who_is_this_for: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>

                  {/* Course details row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div>
                      <label style={labelStyle}>Skill Level</label>
                      <select value={descForm.skill_level} onChange={e => setDescForm(p => ({ ...p, skill_level: e.target.value as any }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Duration (hrs)</label>
                      <input type="number" min={1} value={descForm.duration_hours} onChange={e => setDescForm(p => ({ ...p, duration_hours: e.target.value }))} style={inputStyle} placeholder="12" />
                    </div>
                    <div>
                      <label style={labelStyle}>Language</label>
                      <input value={descForm.language} onChange={e => setDescForm(p => ({ ...p, language: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>

                  {/* Certificate description */}
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Certificate Description</label>
                    <p style={helperStyle}>Shown at the bottom of the course card</p>
                    <textarea value={descForm.certificate_description} onChange={e => setDescForm(p => ({ ...p, certificate_description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid #E8F0FB', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
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
