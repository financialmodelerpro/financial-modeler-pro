'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import {
  renderShareTemplate, resolveCourseName, formatShareDate,
  DEFAULT_TEMPLATES, type ShareTemplate,
} from '@/src/lib/training/shareTemplates';

const NAVY   = '#1B3A6B';
const BLUE   = '#1B4F8A';
const GOLD   = '#C9A84C';
const BORDER = '#E5E7EB';
const MUTED  = '#6B7280';
const GREEN  = '#2EAA4A';

interface CertRow {
  certificate_id:   string;
  full_name:        string | null;
  email:            string | null;
  course:           string | null;
  course_code:      string | null;
  verification_url: string | null;
  issued_at:        string | null;
  grade:            string | null;
}

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: MUTED,
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6,
};
const field: React.CSSProperties = {
  padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};
const btn = (bg: string, fg = '#fff', disabled = false): React.CSSProperties => ({
  padding: '9px 18px', borderRadius: 7, border: 'none',
  fontSize: 13, fontWeight: 700, background: bg, color: fg,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

/** Build the student-list block from selected certs. */
function buildStudentList(certs: CertRow[]): string {
  return certs.map(c => {
    const name   = c.full_name?.trim() || 'Student';
    const course = resolveCourseName(c.course || c.course_code || '');
    return `✅ ${name} — ${course}`;
  }).join('\n');
}

/** Build the verify-links block — short-form (host + path), bullet prefix. */
function buildVerifyLinks(certs: CertRow[]): string {
  return certs.map(c => {
    const url = c.verification_url || '';
    // Strip scheme for the compact display, but include the full URL so it's
    // clickable when pasted to LinkedIn.
    return `• ${url}`;
  }).join('\n');
}

export default function DailyRoundupPage() {
  const [date, setDate]             = useState(todayIsoDate());
  const [loading, setLoading]       = useState(false);
  const [certs, setCerts]           = useState<CertRow[]>([]);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [template, setTemplate]     = useState<ShareTemplate>(DEFAULT_TEMPLATES.daily_certifications_roundup);
  const [shareOpen, setShareOpen]   = useState(false);
  const [toast, setToast]           = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Load the latest admin-edited template so this page reflects edits made
  // in /admin/training-hub/share-templates without a page refresh.
  useEffect(() => {
    fetch('/api/share-templates/daily_certifications_roundup')
      .then(r => r.json())
      .then((j: { template: ShareTemplate | null }) => {
        if (j.template) setTemplate(j.template);
      })
      .catch(() => { /* keep fallback */ });
  }, []);

  // Fetch certificates for the selected date. Auto-selects all rows so the
  // default roundup contains the whole day — admin deselects to trim.
  const loadCerts = useCallback(async (isoDate: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/certificates/by-date?date=${encodeURIComponent(isoDate)}`);
      const j   = await res.json() as { certificates?: CertRow[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? 'Fetch failed');
      const rows = j.certificates ?? [];
      setCerts(rows);
      setSelected(new Set(rows.map(r => r.certificate_id)));
    } catch (e) {
      setCerts([]);
      setSelected(new Set());
      showToast((e as Error).message);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { void loadCerts(date); }, [date, loadCerts]);

  const selectedCerts = useMemo(
    () => certs.filter(c => selected.has(c.certificate_id)),
    [certs, selected],
  );

  const rendered = useMemo(() => renderShareTemplate(template, {
    date:        formatShareDate(date),
    count:       selectedCerts.length,
    studentList: buildStudentList(selectedCerts),
    verifyLinks: buildVerifyLinks(selectedCerts),
  }), [template, selectedCerts, date]);

  function toggle(certId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(certId)) next.delete(certId);
      else next.add(certId);
      return next;
    });
  }
  function selectAll()  { setSelected(new Set(certs.map(c => c.certificate_id))); }
  function selectNone() { setSelected(new Set()); }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/daily-roundup" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Daily Certifications Roundup</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, maxWidth: 720, lineHeight: 1.55 }}>
            Pick a date, choose which of that day&apos;s newly certified students to feature, and share one
            roundup post celebrating the whole cohort. Template copy is edited on the&nbsp;
            <Link href="/admin/training-hub/share-templates" style={{ color: BLUE, textDecoration: 'none', fontWeight: 600 }}>
              Share Templates page
            </Link>.
          </p>
        </div>

        {/* Date picker + summary row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16, background: '#fff', border: `1px solid ${BORDER}`,
          borderRadius: 12, padding: '18px 22px', marginBottom: 20,
        }}>
          <div>
            <label style={label}>Date</label>
            <input
              type="date"
              value={date}
              max={todayIsoDate()}
              onChange={e => setDate(e.target.value)}
              style={{ ...field, width: '100%' }}
            />
            <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
              UTC day boundary — certs issued between 00:00 and 24:00 UTC.
            </div>
          </div>
          <div>
            <label style={label}>Certificates issued</label>
            <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>
              {loading ? '…' : certs.length}
            </div>
            <div style={{ fontSize: 11, color: MUTED }}>
              {certs.length === 0 ? 'no certificates on this date' : `${selectedCerts.length} selected`}
            </div>
          </div>
          <div>
            <label style={label}>Actions</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={selectAll}  disabled={certs.length === 0} style={btn('#F3F4F6', NAVY, certs.length === 0)}>
                Select all
              </button>
              <button type="button" onClick={selectNone} disabled={certs.length === 0} style={btn('#F3F4F6', NAVY, certs.length === 0)}>
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Student list */}
        <div style={{
          background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: '0.1em', marginBottom: 12 }}>
            🎓 STUDENTS CERTIFIED ON {formatShareDate(date).toUpperCase()}
          </div>
          {loading ? (
            <div style={{ padding: 16, color: MUTED, fontSize: 13 }}>Loading…</div>
          ) : certs.length === 0 ? (
            <div style={{ padding: 16, color: MUTED, fontSize: 13 }}>
              No certificates were issued on this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {certs.map(c => {
                const isChecked = selected.has(c.certificate_id);
                return (
                  <label
                    key={c.certificate_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 8,
                      border: `1px solid ${isChecked ? '#BAE6FD' : BORDER}`,
                      background: isChecked ? '#F0F9FF' : '#FAFAFA',
                      cursor: 'pointer',
                      transition: 'background 0.12s, border 0.12s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(c.certificate_id)}
                      style={{ width: 16, height: 16, accentColor: BLUE }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                        {c.full_name || c.email || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: MUTED }}>
                        {resolveCourseName(c.course || c.course_code || '—')}
                        {' · '}
                        <code style={{ fontFamily: 'monospace' }}>{c.certificate_id}</code>
                        {c.grade ? ` · Grade ${c.grade}` : ''}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 800, color: GOLD,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                      Issued
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview + share */}
        <div style={{
          background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: '18px 22px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: '0.1em' }}>
              📝 ROUNDUP PREVIEW
            </div>
            <div style={{ fontSize: 11, color: MUTED }}>
              Template: <code style={{ color: GOLD }}>daily_certifications_roundup</code>
            </div>
          </div>
          <div style={{
            background: '#F9FAFB', border: `1px dashed ${BORDER}`, borderRadius: 8,
            padding: '14px 16px', fontSize: 13, color: '#1F2937',
            whiteSpace: 'pre-wrap', lineHeight: 1.65, fontFamily: 'Inter, sans-serif',
            minHeight: 160,
          }}>
            {rendered.text}
            {rendered.hashtags.length > 0 && (
              <>
                {'\n\n'}
                {rendered.hashtags.map(h => `#${h}`).join(' ')}
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              disabled={selectedCerts.length === 0}
              style={btn(GREEN, '#fff', selectedCerts.length === 0)}
            >
              🚀 Share Roundup
            </button>
          </div>
        </div>

        {toast && (
          <div style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
            padding: '12px 18px', borderRadius: 10,
            background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}>
            {toast}
          </div>
        )}

        <ShareModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          title="🚀 Share Daily Roundup"
          text={rendered.text}
          hashtags={rendered.hashtags}
        />
      </main>
    </div>
  );
}
