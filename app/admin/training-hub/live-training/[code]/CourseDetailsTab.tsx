'use client';

/**
 * Live Training > course > Details: what the public course card and course
 * page show, the images (with recommended sizes and alt text), enrolment
 * Open / Closed, and the regions in the time zone table.
 */
import React, { useState } from 'react';
import type { LiveCourseSettings } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { DEFAULT_TIME_ZONES, regionLabel } from '@/src/hubs/training/lib/liveCourse/timeZones';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', fontFamily: 'inherit', fontSize: 13 };
const btn: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff' };

export const IMAGE_SPECS = {
  banner: { title: 'Course banner (hero on the course page)', size: '1920 x 640 px (3:1)', note: 'JPG or WebP, under 600 KB. Keep text and faces in the middle; the edges crop on phones.' },
  card: { title: 'Course card image (Training Sessions page)', size: '1200 x 675 px (16:9)', note: 'JPG or WebP, under 300 KB.' },
} as const;

export function CourseDetailsTab({ course, onSaved }: { course: LiveCourseSettings; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({
    title: course.title, shortTitle: course.shortTitle, tagline: course.tagline, description: course.description,
    whoFor: course.whoFor, prerequisites: course.prerequisites, trainerName: course.trainerName, trainerTitle: course.trainerTitle,
    enrolmentOpen: course.enrolmentOpen,
  });
  const [zones, setZones] = useState<string[]>(course.timeZones ?? DEFAULT_TIME_ZONES.map((r) => r.tz));
  const [extraZone, setExtraZone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true); setErr('');
    try {
      const isDefault = zones.length === DEFAULT_TIME_ZONES.length && zones.every((z, i) => z === DEFAULT_TIME_ZONES[i].tz);
      const r = await fetch(`/api/admin/live-course/${course.courseCode}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, timeZones: isDefault ? null : zones }),
      });
      const j = await r.json() as { error?: string };
      if (!r.ok) { setErr(j.error ?? 'Save failed.'); return; }
      onSaved('Details saved.');
    } finally { setSaving(false); }
  }

  const text = (key: keyof typeof f, l: string, opts: { area?: boolean; hint?: string } = {}) => (
    <div style={{ marginBottom: 14 }}>
      <label style={label}>{l}</label>
      {opts.area
        ? <textarea value={String(f[key] ?? '')} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} style={{ ...input, minHeight: 90 }} />
        : <input value={String(f[key] ?? '')} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} style={input} />}
      {opts.hint && <div style={{ fontSize: 11.5, color: SLATE, marginTop: 3 }}>{opts.hint}</div>}
    </div>
  );

  const allZones = [...new Set([...DEFAULT_TIME_ZONES.map((r) => r.tz), ...zones])];

  return (
    <div data-testid="course-details-tab" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 24 }}>
      <div style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 20 }}>
        {text('title', 'Title')}
        {text('shortTitle', 'Short title', { hint: 'Used in tight spaces, e.g. "REFM".' })}
        {text('tagline', 'Tagline', { hint: 'One line under the title on the card and the course page.' })}
        {text('description', 'Full description', { area: true })}
        {text('whoFor', 'Who it is for', { area: true })}
        {text('prerequisites', 'Prerequisites', { area: true })}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {text('trainerName', 'Trainer')}
          {text('trainerTitle', 'Trainer title')}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Enrolment</label>
          <label style={{ fontSize: 13, marginRight: 18 }}><input type="radio" checked={f.enrolmentOpen} onChange={() => setF((x) => ({ ...x, enrolmentOpen: true }))} /> Open</label>
          <label style={{ fontSize: 13 }}><input data-testid="enrolment-closed" type="radio" checked={!f.enrolmentOpen} onChange={() => setF((x) => ({ ...x, enrolmentOpen: false }))} /> Closed (the card shows "Enrolment closed"; enrolled students keep access)</label>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Time zones to show ({zones.length})</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {allZones.map((tz) => (
              <label key={tz} style={{ fontSize: 12.5 }}>
                <input type="checkbox" checked={zones.includes(tz)} onChange={(e) => setZones((z) => (e.target.checked ? [...z, tz] : z.filter((x) => x !== tz)))} /> {regionLabel(tz)}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={extraZone} onChange={(e) => setExtraZone(e.target.value)} placeholder="Add a zone, e.g. Asia/Singapore" style={{ ...input, width: 260 }} />
            <button style={btn} onClick={() => { if (extraZone.trim()) { setZones((z) => [...new Set([...z, extraZone.trim()])]); setExtraZone(''); } }}>Add</button>
            <button style={btn} onClick={() => setZones(DEFAULT_TIME_ZONES.map((r) => r.tz))}>Reset to default</button>
          </div>
        </div>
        <button data-testid="save-course-details" style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{err}</div>}
      </div>

      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <ImageField course={course} kind="banner" url={course.bannerUrl} alt={course.bannerAlt} onSaved={onSaved} />
        <ImageField course={course} kind="card" url={course.cardImageUrl} alt={course.cardImageAlt} onSaved={onSaved} />
        <div style={{ fontSize: 12, color: SLATE, background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 14 }}>
          <strong style={{ color: NAVY }}>Session banners:</strong> on the Sessions tab, edit a session and use Banner Image (1600 x 600 px). A session with no banner shows the course banner.
        </div>
      </div>
    </div>
  );
}

function ImageField({ course, kind, url, alt, onSaved }: { course: LiveCourseSettings; kind: 'banner' | 'card'; url: string | null; alt: string; onSaved: (m: string) => void }) {
  const spec = IMAGE_SPECS[kind];
  const [altText, setAltText] = useState(alt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function send(file: File | null) {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('kind', kind); fd.append('alt', altText);
      if (file) fd.append('file', file);
      const r = await fetch(`/api/admin/live-course/${course.courseCode}/image`, { method: 'POST', body: fd });
      const j = await r.json() as { error?: string };
      if (!r.ok) { setErr(j.error ?? 'Upload failed.'); return; }
      onSaved(file ? 'Image uploaded.' : 'Alt text saved.');
    } finally { setBusy(false); }
  }
  return (
    <div data-testid={`course-image-${kind}`} style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 800, color: NAVY, fontSize: 13 }}>{spec.title}</div>
      <div style={{ fontSize: 11.5, color: SLATE, margin: '2px 0 8px' }}>Recommended <strong>{spec.size}</strong>. {spec.note}</div>
      {url
        ? <img src={url} alt={alt || spec.title} style={{ width: '100%', aspectRatio: kind === 'banner' ? '3 / 1' : '16 / 9', objectFit: 'cover', borderRadius: 6, border: `1px solid ${PALE}` }} />
        : <div style={{ aspectRatio: kind === 'banner' ? '3 / 1' : '16 / 9', background: '#F5F7FA', borderRadius: 6, display: 'grid', placeItems: 'center', color: SLATE, fontSize: 12 }}>No image</div>}
      <label style={{ ...label, marginTop: 8 }}>Alt text (describes the image for screen readers)</label>
      <input value={altText} onChange={(e) => setAltText(e.target.value)} style={input} placeholder="e.g. Trainer presenting a real estate model" />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <label style={{ ...btnPrimary, display: 'inline-block' }}>
          {busy ? 'Uploading…' : url ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => { void send(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
        <button style={btn} onClick={() => send(null)} disabled={busy}>Save alt text</button>
        {url && <button style={btn} onClick={async () => { await fetch(`/api/admin/live-course/${course.courseCode}/image?kind=${kind}`, { method: 'DELETE' }); onSaved('Image removed.'); }}>Remove</button>}
      </div>
      {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
