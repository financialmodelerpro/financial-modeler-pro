'use client';

/**
 * Live Training > course > Certificate: the certification rules and the
 * certificate and badge templates for this course (the engine reads
 * templates/<code>-template.pdf and templates/<code>-badge.png).
 */
import React, { useState } from 'react';
import type { LiveCourseSettings } from '@/src/hubs/training/lib/liveCourse/courseSettings';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 4 };
const input: React.CSSProperties = { padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', width: 120, fontSize: 13 };
const btn: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff' };

export function CourseCertificateTab({ course, onSaved }: { course: LiveCourseSettings; onSaved: (msg: string) => void }) {
  const [r, setR] = useState({
    attendanceThresholdPct: String(course.attendanceThresholdPct),
    recordingCompletePct: String(course.recordingCompletePct),
    maxSubmissionAttempts: String(course.maxSubmissionAttempts),
    allowMixedRoutes: course.allowMixedRoutes,
    live: course.certRoutes.includes('live'),
    recording: course.certRoutes.includes('recording'),
    certificateGradeLabel: course.certificateGradeLabel,
    sessionCertificates: course.sessionCertificates,
  });
  const [err, setErr] = useState('');
  const code = course.courseCode.toLowerCase();

  async function save() {
    setErr('');
    const res = await fetch(`/api/admin/live-course/${course.courseCode}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendanceThresholdPct: Number(r.attendanceThresholdPct),
        recordingCompletePct: Number(r.recordingCompletePct),
        maxSubmissionAttempts: Number(r.maxSubmissionAttempts),
        allowMixedRoutes: r.allowMixedRoutes,
        certRoutes: [...(r.live ? ['live'] : []), ...(r.recording ? ['recording'] : [])],
        certificateGradeLabel: r.certificateGradeLabel,
        sessionCertificates: r.sessionCertificates,
      }),
    });
    const j = await res.json() as { error?: string };
    if (!res.ok) { setErr(j.error ?? 'Save failed.'); return; }
    onSaved('Certificate rules saved.');
  }

  async function upload(type: 'cert' | 'badge', file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.append('type', `${code}-${type}`); fd.append('file', file);
    const res = await fetch('/api/admin/certificates/upload-template', { method: 'POST', body: fd });
    const j = await res.json() as { error?: string };
    onSaved(res.ok ? `${type === 'cert' ? 'Certificate' : 'Badge'} template uploaded.` : `Upload failed: ${j.error ?? res.status}`);
  }

  return (
    <div data-testid="course-certificate-tab" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 20 }}>
        <h3 style={{ margin: '0 0 12px', color: NAVY, fontSize: 15 }}>Certification rules</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Routes that count</label>
          <label style={{ fontSize: 13, marginRight: 16 }}><input type="checkbox" checked={r.live} onChange={(e) => setR((x) => ({ ...x, live: e.target.checked }))} /> Live attendance</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={r.recording} onChange={(e) => setR((x) => ({ ...x, recording: e.target.checked }))} /> Recordings</label>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <div><label style={label}>Live attendance per session (%)</label><input style={input} value={r.attendanceThresholdPct} onChange={(e) => setR((x) => ({ ...x, attendanceThresholdPct: e.target.value }))} /></div>
          <div><label style={label}>Recording watched (%)</label><input style={input} value={r.recordingCompletePct} onChange={(e) => setR((x) => ({ ...x, recordingCompletePct: e.target.value }))} /></div>
          <div><label style={label}>Model attempts</label><input style={input} value={r.maxSubmissionAttempts} onChange={(e) => setR((x) => ({ ...x, maxSubmissionAttempts: e.target.value }))} /></div>
        </div>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          <input type="checkbox" checked={r.allowMixedRoutes} onChange={(e) => setR((x) => ({ ...x, allowMixedRoutes: e.target.checked }))} /> Mixed routes: a missed session can be completed by its recording
        </label>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          <input data-testid="session-certificates-toggle" type="checkbox" checked={r.sessionCertificates} onChange={(e) => setR((x) => ({ ...x, sessionCertificates: e.target.checked }))} /> Per-session certificates: the same achievement card single sessions give, issued when a student meets a session's rule
        </label>
        <div style={{ marginBottom: 14 }}><label style={label}>Grade line on the certificate</label><input style={{ ...input, width: 200 }} value={r.certificateGradeLabel} onChange={(e) => setR((x) => ({ ...x, certificateGradeLabel: e.target.value }))} /></div>
        <button data-testid="save-certificate-rules" style={btnPrimary} onClick={save}>Save rules</button>
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <p style={{ fontSize: 11.5, color: SLATE, marginTop: 12 }}>A change applies to everyone's progress at once, including students already enrolled.</p>
      </div>
      <div style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 20 }}>
        <h3 style={{ margin: '0 0 12px', color: NAVY, fontSize: 15 }}>Templates</h3>
        <p style={{ fontSize: 12.5, color: SLATE, marginTop: 0 }}>
          Certificate: a one-page PDF, A4 landscape (842 x 595 pt). Fields are placed by the layout in Certificate Designer, which is shared by every course, so keep the name, date, ID and QR areas where the 3SFM template has them.
          Badge: a PNG, 1000 x 1000 px.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...btnPrimary, display: 'inline-block' }}>Upload certificate (PDF)<input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => { void upload('cert', e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label style={{ ...btn, display: 'inline-block' }}>Upload badge (PNG)<input type="file" accept="image/png" style={{ display: 'none' }} onChange={(e) => { void upload('badge', e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        <p style={{ fontSize: 11.5, color: SLATE }}>Stored as templates/{code}-template.pdf and templates/{code}-badge.png. Without a template, certificates print on a blank page.</p>
      </div>
    </div>
  );
}
