'use client';

/**
 * Live Training > course > Page sections: every section of the public course
 * page (liveCourse/pageSections.ts) with an on/off switch, its content, and
 * the order of the body sections. One save writes the whole page.
 */
import React, { useEffect, useState } from 'react';
import type { LiveCourseSettings } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import {
  ICONS, SECTION_LABELS, type PageConfig, type SectionKey, type IconItem, type FaqItem, type Step,
} from '@/src/hubs/training/lib/liveCourse/pageSections';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: NAVY, margin: '8px 0 4px' };
const input: React.CSSProperties = { width: '100%', padding: 7, borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13, fontFamily: 'inherit' };
const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff', padding: '8px 18px', fontSize: 13 };

/** Move element i by d within a list (pure). */
function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next;
}

interface AdminTestimonial { id: string; source: 'manual' | 'student'; name: string; text: string; status: string }

export function CoursePageSectionsTab({ course, onSaved }: { course: LiveCourseSettings; onSaved: (msg: string) => void }) {
  const [p, setP] = useState<PageConfig>(course.page);
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends SectionKey>(k: K, patch: Partial<PageConfig['sections'][K]>) =>
    setP((x) => ({ ...x, sections: { ...x.sections, [k]: { ...x.sections[k], ...patch } } }));

  async function save() {
    setSaving(true); setErr('');
    try {
      const r = await fetch(`/api/admin/live-course/${course.courseCode}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageSections: p }) });
      const j = await r.json() as { error?: string };
      if (!r.ok) { setErr(j.error ?? 'Save failed.'); return; }
      onSaved('Page sections saved.');
    } finally { setSaving(false); }
  }

  const row = (k: SectionKey, idx: number | null, editor: React.ReactNode) => {
    const s = p.sections[k] as { enabled: boolean };
    return (
      <div key={k} data-testid={`page-section-${k}`} style={{ border: `1px solid ${PALE}`, borderRadius: 10, background: '#fff', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: s.enabled ? NAVY : SLATE, flex: 1 }}>
            <input data-testid={`page-section-toggle-${k}`} type="checkbox" checked={s.enabled} onChange={(e) => set(k, { enabled: e.target.checked } as never)} />
            {SECTION_LABELS[k]}{!s.enabled && <span style={{ fontWeight: 500 }}> (off)</span>}
          </label>
          {idx != null && (
            <>
              <button style={btn} onClick={() => setP((x) => ({ ...x, order: move(x.order, idx, -1) }))} disabled={idx === 0} aria-label="Move up">↑</button>
              <button style={btn} onClick={() => setP((x) => ({ ...x, order: move(x.order, idx, 1) }))} disabled={idx === p.order.length - 1} aria-label="Move down">↓</button>
            </>
          )}
          {editor && <button style={btn} onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Close' : 'Edit'}</button>}
        </div>
        {open === k && editor && <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${PALE}` }}>{editor}</div>}
      </div>
    );
  };

  const heading = (k: SectionKey) => (
    <><label style={label}>Heading</label><input style={input} value={(p.sections[k] as { heading: string }).heading} onChange={(e) => set(k, { heading: e.target.value } as never)} /></>
  );

  const editors: Partial<Record<SectionKey, React.ReactNode>> = {
    about: <p style={{ fontSize: 12.5, color: SLATE }}>The description, who it is for and prerequisites are edited on the Details tab.</p>,
    curriculum: <>{heading('curriculum')}<p style={{ fontSize: 12.5, color: SLATE }}>A compact table of the sessions (number, title, KSA time, status), each linking to its session page. Session content and images are edited on the Sessions tab.</p></>,
    skills: <>{heading('skills')}<IconItems items={p.sections.skills.items} onChange={(items) => set('skills', { items })} /></>,
    whoFor: <>{heading('whoFor')}<IconItems items={p.sections.whoFor.items} onChange={(items) => set('whoFor', { items })} /></>,
    tools: <>{heading('tools')}<IconItems items={p.sections.tools.items} onChange={(items) => set('tools', { items })} /></>,
    certification: (
      <>
        {heading('certification')}
        <Steps steps={p.sections.certification.steps} onChange={(steps) => set('certification', { steps })} />
        <label style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={p.sections.certification.showSamples} onChange={(e) => set('certification', { showSamples: e.target.checked })} /> Show the sample certificate and badge (from the Certificate tab&apos;s templates; hidden until they exist)</label>
      </>
    ),
    instructor: (
      <>
        {heading('instructor')}
        <label style={label}>Short bio (two or three lines; empty = the first two sentences of the full bio)</label>
        <textarea data-testid="instructor-short-bio" style={{ ...input, minHeight: 70 }} value={p.sections.instructor.shortBio} onChange={(e) => set('instructor', { shortBio: e.target.value })} />
        <p style={{ fontSize: 12.5, color: SLATE }}>The instructors are picked on the Details tab. Photo, name, credentials, title, highlights and links come from the founder profile (Page Builder &gt; Home &gt; Team).</p>
      </>
    ),
    testimonials: <>{heading('testimonials')}<TestimonialPicker ids={p.sections.testimonials.ids} onChange={(ids) => set('testimonials', { ids })} /></>,
    faq: <>{heading('faq')}<FaqEditor items={p.sections.faq.items} onChange={(items) => set('faq', { items })} /></>,
    cta: <><label style={label}>Call to action text</label><textarea style={{ ...input, minHeight: 60 }} value={p.sections.cta.text} onChange={(e) => set('cta', { text: e.target.value })} /></>,
  };

  return (
    <div data-testid="course-page-sections-tab" style={{ maxWidth: 860 }}>
      <p style={{ fontSize: 13, color: SLATE, marginTop: 0 }}>Switch sections on or off, edit their content and order the page body. The hero and side card stay at the top.</p>
      {row('hero', null, (
        <>
          <label style={label}>Key facts (one per line; leave empty to build them from the schedule)</label>
          <textarea data-testid="hero-facts" style={{ ...input, minHeight: 90 }} value={p.sections.hero.facts.join('\n')} onChange={(e) => set('hero', { facts: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
          <label style={{ fontSize: 13, display: 'block', marginTop: 8 }}><input type="checkbox" checked={p.sections.hero.countdown} onChange={(e) => set('hero', { countdown: e.target.checked })} /> Show the countdown to the next session (hides once the course has ended)</label>
        </>
      ))}
      {row('sideCard', null, (
        <>
          <label style={label}>Show the enrolled count once it reaches</label>
          <input data-testid="enrolled-threshold" type="number" min={1} style={{ ...input, width: 120 }} value={p.sections.sideCard.enrolledThreshold} onChange={(e) => set('sideCard', { enrolledThreshold: Number(e.target.value) || 0 })} />
        </>
      ))}
      <div style={{ fontSize: 12, fontWeight: 800, color: SLATE, margin: '14px 0 6px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Page body (in order)</div>
      {p.order.map((k, i) => row(k, i, editors[k] ?? null))}
      <div style={{ position: 'sticky', bottom: 0, background: '#F4F7FC', padding: '10px 0' }}>
        <button data-testid="save-page-sections" style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save page sections'}</button>
        {err && <span style={{ color: '#B91C1C', fontSize: 13, marginLeft: 10 }}>{err}</span>}
      </div>
    </div>
  );
}

function IconItems({ items, onChange }: { items: IconItem[]; onChange: (v: IconItem[]) => void }) {
  const upd = (i: number, patch: Partial<IconItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ marginTop: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 2fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <select style={input} value={it.icon} onChange={(e) => upd(i, { icon: e.target.value as IconItem['icon'] })}>{ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</select>
          <input style={input} value={it.title} placeholder="Title" onChange={(e) => upd(i, { title: e.target.value })} />
          <input style={input} value={it.text} placeholder="Text" onChange={(e) => upd(i, { text: e.target.value })} />
          <span style={{ display: 'flex', gap: 4 }}>
            <button style={btn} onClick={() => onChange(move(items, i, -1))} aria-label="Move up">↑</button>
            <button style={btn} onClick={() => onChange(move(items, i, 1))} aria-label="Move down">↓</button>
            <button style={{ ...btn, color: '#B91C1C', borderColor: '#B91C1C' }} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </span>
        </div>
      ))}
      <button style={btn} onClick={() => onChange([...items, { icon: 'check-circle', title: '', text: '' }])}>+ Add item</button>
    </div>
  );
}

function Steps({ steps, onChange }: { steps: Step[]; onChange: (v: Step[]) => void }) {
  const upd = (i: number, patch: Partial<Step>) => onChange(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ marginTop: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, marginBottom: 6 }}>
          <input style={input} value={s.title} placeholder={`Step ${i + 1} title`} onChange={(e) => upd(i, { title: e.target.value })} />
          <input style={input} value={s.text} placeholder="Text" onChange={(e) => upd(i, { text: e.target.value })} />
          <span style={{ display: 'flex', gap: 4 }}>
            <button style={btn} onClick={() => onChange(move(steps, i, -1))}>↑</button>
            <button style={btn} onClick={() => onChange(move(steps, i, 1))}>↓</button>
            <button style={{ ...btn, color: '#B91C1C', borderColor: '#B91C1C' }} onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
          </span>
        </div>
      ))}
      <button style={btn} onClick={() => onChange([...steps, { title: '', text: '' }])}>+ Add step</button>
    </div>
  );
}

function FaqEditor({ items, onChange }: { items: FaqItem[]; onChange: (v: FaqItem[]) => void }) {
  const upd = (i: number, patch: Partial<FaqItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div data-testid="faq-editor" style={{ marginTop: 8 }}>
      {items.map((f, i) => (
        <div key={i} style={{ border: `1px solid ${PALE}`, borderRadius: 8, padding: 8, marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={input} value={f.q} placeholder="Question" onChange={(e) => upd(i, { q: e.target.value })} />
            <button style={btn} onClick={() => onChange(move(items, i, -1))} aria-label="Move up">↑</button>
            <button style={btn} onClick={() => onChange(move(items, i, 1))} aria-label="Move down">↓</button>
            <button style={{ ...btn, color: '#B91C1C', borderColor: '#B91C1C' }} onClick={() => onChange(items.filter((_, j) => j !== i))}>Delete</button>
          </div>
          <textarea style={{ ...input, minHeight: 50, marginTop: 6 }} value={f.a} placeholder="Answer" onChange={(e) => upd(i, { a: e.target.value })} />
        </div>
      ))}
      <button style={btn} onClick={() => onChange([...items, { q: '', a: '' }])}>+ Add question</button>
    </div>
  );
}

function TestimonialPicker({ ids, onChange }: { ids: string[]; onChange: (v: string[]) => void }) {
  const [all, setAll] = useState<AdminTestimonial[] | null>(null);
  useEffect(() => {
    fetch('/api/admin/testimonials').then((r) => r.json()).then((j: { testimonials?: AdminTestimonial[] }) => setAll((j.testimonials ?? []).filter((t) => t.status === 'approved'))).catch(() => setAll([]));
  }, []);
  const key = (t: AdminTestimonial) => `${t.source}:${t.id}`;
  return (
    <div data-testid="testimonial-picker" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: SLATE, marginBottom: 6 }}>Approved testimonials from the existing system ({ids.length} picked). The section hides when none are picked.</div>
      {!all && <div style={{ fontSize: 12, color: SLATE }}>Loading…</div>}
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 4 }}>
        {all?.map((t) => (
          <label key={key(t)} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ids.includes(key(t))} onChange={(e) => onChange(e.target.checked ? [...ids, key(t)] : ids.filter((x) => x !== key(t)))} />
            <span><strong>{t.name}</strong> <span style={{ color: SLATE }}>({t.source})</span>: {t.text.slice(0, 120)}{t.text.length > 120 ? '…' : ''}</span>
          </label>
        ))}
        {all?.length === 0 && <div style={{ fontSize: 12, color: SLATE }}>No approved testimonials yet.</div>}
      </div>
    </div>
  );
}
