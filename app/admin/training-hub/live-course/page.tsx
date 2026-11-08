'use client';

/**
 * Admin: live courses (REFM). Per session: sync Teams attendance through
 * Microsoft Graph, upload the Teams attendance CSV as a fallback, match
 * unmatched emails (optionally remembered), and enter a figure by hand.
 * The Progress tab (per student, per session) is the eligibility view.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { LiveCourseProgressTab } from './LiveCourseProgressTab';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

interface Course { courseCode: string; title: string; attendanceThresholdPct: number }
interface AdminSession {
  id: string; title: string; course_session_no: number | null; scheduled_datetime: string | null;
  is_published: boolean; youtube_url: string | null; has_link?: boolean;
  attendance_synced_at?: string | null; attendance_sync_error?: string | null;
  attendance: { matched: number; unmatched: number };
}
interface AttRow {
  attendee_email: string; attendee_name: string | null; student_email: string | null; matched_by: string | null;
  attended_seconds: number; session_seconds: number; attended_pct: number; source: string; role: string | null;
}
interface Student { email: string; name: string; registrationId: string }

const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700 };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${PALE}`, fontSize: 13 };

/** Decode a Teams export (often UTF-16 with a BOM) in the browser. */
async function readReportFile(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

export default function LiveCourseAdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'sessions' | 'progress'>('sessions');
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [att, setAtt] = useState<{ rows: AttRow[]; students: Student[]; teamsConfigured: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [manual, setManual] = useState({ studentEmail: '', pct: '' });

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    fetch('/api/admin/live-course').then((r) => r.json()).then((j: { courses?: Course[] }) => {
      setCourses(j.courses ?? []);
      if (j.courses?.length) setCode(j.courses[0].courseCode);
    }).catch(() => {});
  }, []);

  const loadSessions = useCallback(async () => {
    if (!code) return;
    const j = await fetch(`/api/admin/live-course/${code}`).then((r) => r.json()) as { sessions?: AdminSession[] };
    setSessions(j.sessions ?? []);
  }, [code]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const loadAtt = useCallback(async (id: string) => {
    const j = await fetch(`/api/admin/live-sessions/${id}/attendance`).then((r) => r.json());
    setAtt({ rows: j.rows ?? [], students: j.students ?? [], teamsConfigured: !!j.teamsConfigured });
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000); };

  async function act(id: string, payload: Record<string, unknown>, label: string) {
    setBusy(`${id}:${label}`);
    try {
      const r = await fetch(`/api/admin/live-sessions/${id}/attendance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) { flash(`${label} failed: ${j.error ?? r.status}`); return; }
      if (j.result) flash(`${label}: ${j.result.saved} attendees, ${j.result.matched} matched, ${j.result.unmatched} unmatched${j.result.keptManual ? `, ${j.result.keptManual} manual kept` : ''}.${j.warnings?.length ? ' ' + j.warnings.join(' ') : ''}`);
      else flash(`${label} saved.`);
      await Promise.all([loadSessions(), openId === id ? loadAtt(id) : Promise.resolve()]);
    } finally { setBusy(''); }
  }

  async function uploadCsv(id: string, f: File | undefined) {
    if (!f) return;
    const text = await readReportFile(f);
    await act(id, { action: 'csv', text, timeZone: 'Asia/Riyadh' }, 'CSV import');
  }

  const unmatched = att?.rows.filter((r) => !r.student_email) ?? [];
  const matched = att?.rows.filter((r) => r.student_email) ?? [];
  const threshold = courses.find((c) => c.courseCode === code)?.attendanceThresholdPct ?? 75;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/live-course" />
      <main data-testid="admin-live-course" style={{ flex: 1, padding: 40, overflowY: 'auto', color: '#2A3440' }}>
        {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, maxWidth: 520, background: NAVY, color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 900 }}>{toast}</div>}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', margin: '0 0 6px' }}>Live Courses</h1>
        <p style={{ color: SLATE, fontSize: 13, margin: '0 0 18px' }}>Attendance from Microsoft Teams, recordings and certification progress. Sessions are created and edited on the Live Sessions page (pick the course and session number there).</p>

        {courses.length === 0 && <div style={{ color: SLATE }}>No live course is set up.</div>}
        {courses.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <select value={code} onChange={(e) => { setCode(e.target.value); setOpenId(null); setAtt(null); }} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}>
              {courses.map((c) => <option key={c.courseCode} value={c.courseCode}>{c.courseCode} - {c.title}</option>)}
            </select>
            <button style={tab === 'sessions' ? btnPrimary : btn} onClick={() => setTab('sessions')}>Sessions & attendance</button>
            <button style={tab === 'progress' ? btnPrimary : btn} onClick={() => setTab('progress')}>Student progress</button>
          </div>
        )}

        {tab === 'progress' && code && <LiveCourseProgressTab courseCode={code} />}

        {tab === 'sessions' && code && (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
            <thead><tr>
              <th style={th}>No.</th><th style={th}>Session</th><th style={th}>When (KSA)</th><th style={th}>Recording</th>
              <th style={th}>Attendance</th><th style={th}>Actions</th>
            </tr></thead>
            <tbody>
              {sessions.map((s) => (
                <React.Fragment key={s.id}>
                  <tr data-testid="admin-course-session">
                    <td style={td}>{s.course_session_no ?? '-'}</td>
                    <td style={td}><strong>{s.title}</strong>{!s.is_published && <span style={{ color: '#B45309', fontSize: 11, marginLeft: 6 }}>(unpublished)</span>}</td>
                    <td style={td}>{formatSessionTime(s.scheduled_datetime)}</td>
                    <td style={td}>{s.youtube_url ? '✓ added' : <span style={{ color: SLATE }}>none</span>}</td>
                    <td style={td}>
                      {s.attendance_synced_at
                        ? <>{s.attendance.matched} matched{s.attendance.unmatched ? <span style={{ color: '#B91C1C' }}>, {s.attendance.unmatched} unmatched</span> : ''}<div style={{ fontSize: 11, color: SLATE }}>synced {new Date(s.attendance_synced_at).toLocaleString()}</div></>
                        : <span style={{ color: SLATE }}>not synced</span>}
                      {s.attendance_sync_error && <div style={{ fontSize: 11, color: '#B91C1C', maxWidth: 320 }}>{s.attendance_sync_error}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button data-testid="admin-sync-attendance" style={btn} disabled={!!busy || !s.has_link} title={s.has_link ? '' : 'No Teams link on this session'} onClick={() => act(s.id, { action: 'sync' }, 'Sync attendance')}>
                        {busy === `${s.id}:Sync attendance` ? 'Syncing…' : 'Sync attendance'}
                      </button>{' '}
                      <label style={{ ...btn, display: 'inline-block' }}>
                        Upload CSV
                        <input data-testid="admin-attendance-csv" type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={(e) => { void uploadCsv(s.id, e.target.files?.[0]); e.target.value = ''; }} />
                      </label>{' '}
                      <button style={btn} onClick={() => { const next = openId === s.id ? null : s.id; setOpenId(next); setAtt(null); if (next) void loadAtt(next); }}>{openId === s.id ? 'Hide' : 'View'}</button>
                    </td>
                  </tr>
                  {openId === s.id && (
                    <tr><td colSpan={6} style={{ padding: 16, background: '#F8FAFD' }}>
                      {!att && <div style={{ color: SLATE }}>Loading…</div>}
                      {att && (
                        <div style={{ display: 'grid', gap: 18 }}>
                          {unmatched.length > 0 && (
                            <div data-testid="admin-unmatched">
                              <h3 style={{ fontSize: 14, color: '#B91C1C', margin: '0 0 8px' }}>Unmatched ({unmatched.length}): Teams emails with no Training Hub student</h3>
                              {unmatched.map((u) => <UnmatchedRow key={u.attendee_email} row={u} students={att.students} onMatch={(studentEmail, remember) => act(s.id, { action: 'match', attendeeEmail: u.attendee_email, studentEmail, remember }, 'Match')} />)}
                            </div>
                          )}
                          <div>
                            <h3 style={{ fontSize: 14, color: NAVY, margin: '0 0 8px' }}>Matched ({matched.length}) · pass mark {threshold}%</h3>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead><tr><th style={th}>Student</th><th style={th}>Teams identity</th><th style={th}>Minutes</th><th style={th}>Attended</th><th style={th}>Source</th></tr></thead>
                              <tbody>{matched.map((r) => (
                                <tr key={r.attendee_email}>
                                  <td style={td}>{r.student_email}</td>
                                  <td style={td}>{r.attendee_name ?? ''} <span style={{ color: SLATE, fontSize: 11 }}>{r.attendee_email}</span></td>
                                  <td style={td}>{Math.round(r.attended_seconds / 60)} / {Math.round(r.session_seconds / 60)}</td>
                                  <td style={{ ...td, fontWeight: 700, color: r.attended_pct >= threshold ? '#2E7D52' : '#B91C1C' }}>{r.attended_pct.toFixed(1)}%</td>
                                  <td style={td}>{r.source}{r.matched_by && r.matched_by !== 'email' ? ` (${r.matched_by})` : ''}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 13 }}>Enter attendance by hand:</strong>
                            <input list={`stu-${s.id}`} placeholder="student email" value={manual.studentEmail} onChange={(e) => setManual((m) => ({ ...m, studentEmail: e.target.value }))} style={{ padding: 6, borderRadius: 6, border: '1px solid #CBD5E1', width: 240 }} />
                            <datalist id={`stu-${s.id}`}>{att.students.map((st) => <option key={st.email} value={st.email}>{st.name}</option>)}</datalist>
                            <input type="number" min={0} max={100} placeholder="%" value={manual.pct} onChange={(e) => setManual((m) => ({ ...m, pct: e.target.value }))} style={{ padding: 6, borderRadius: 6, border: '1px solid #CBD5E1', width: 80 }} />
                            <button style={btnPrimary} disabled={!manual.studentEmail || manual.pct === ''} onClick={() => act(s.id, { action: 'manual', studentEmail: manual.studentEmail, attendedPct: Number(manual.pct) }, 'Manual attendance').then(() => setManual({ studentEmail: '', pct: '' }))}>Save</button>
                            <span style={{ fontSize: 11, color: SLATE }}>A hand-entered figure is never overwritten by a later sync.</span>
                          </div>
                        </div>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              {sessions.length === 0 && <tr><td colSpan={6} style={{ ...td, color: SLATE }}>No sessions yet. Create them on the Live Sessions page and pick this course.</td></tr>}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

function UnmatchedRow({ row, students, onMatch }: { row: AttRow; students: Student[]; onMatch: (studentEmail: string, remember: boolean) => void }) {
  const [pick, setPick] = useState('');
  const [remember, setRemember] = useState(true);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${PALE}`, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 260 }}><strong>{row.attendee_name ?? '(no name)'}</strong> <span style={{ color: SLATE, fontSize: 12 }}>{row.attendee_email.startsWith('noemail:') ? 'no email from Teams' : row.attendee_email}</span></div>
      <div style={{ minWidth: 90, fontSize: 12 }}>{row.attended_pct.toFixed(1)}%</div>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #CBD5E1', minWidth: 240 }}>
        <option value="">Match to student…</option>
        {students.map((s) => <option key={s.email} value={s.email}>{s.name} ({s.email})</option>)}
      </select>
      <label style={{ fontSize: 12 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> remember for later sessions</label>
      <button style={btnPrimary} disabled={!pick} onClick={() => onMatch(pick, remember)}>Match</button>
    </div>
  );
}
