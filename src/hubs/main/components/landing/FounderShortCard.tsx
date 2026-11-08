/**
 * The founder as a course instructor, SHORT (2026-11-08): photo, name,
 * credentials, title, a two to three line bio, up to three highlights, and
 * "Read full profile" + "Connect on LinkedIn". Every field comes from the one
 * founder record through founderProfile(), so nothing is duplicated. The bio
 * is the course's short bio (Page sections > Instructor) when set, else the
 * first two sentences of the full bio.
 */
import Link from 'next/link';
import { founderProfile } from './FounderProfileBlock';

/** The first two sentences of a bio (HTML stripped), for a short instructor card. */
export function firstSentences(html: string, n = 2): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  return parts ? parts.slice(0, n).join('').trim() : text;
}

const NAVY = '#0D2E5A';
const GOLD = '#C9A84C';

export function FounderShortCard({ content, shortBio, heading }: {
  content: Record<string, unknown> | null | undefined;
  /** The course's own short bio; empty = the first two sentences of the full bio. */
  shortBio?: string;
  heading?: string;
}) {
  const p = founderProfile(content);
  const bio = (shortBio ?? '').trim() || firstSentences(p.fBio, 2);
  const highlights = (Array.isArray(p.fCreds) ? p.fCreds : []).slice(0, 3);
  return (
    <div data-testid="founder-short-card" style={{ background: '#fff', border: '1px solid #E8EEF7', borderRadius: 14, padding: 'clamp(16px,3vw,24px)' }}>
      {heading && <div style={{ fontSize: 12, fontWeight: 800, color: GOLD, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>{heading}</div>}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {p.fPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.fPhoto} alt={p.fName} style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', flexShrink: 0, background: '#EEF3FA' }} />
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: NAVY }}>{p.fName}{p.fQuals ? <span style={{ fontSize: 13, fontWeight: 700, color: '#5A6675' }}>, {p.fQuals}</span> : null}</div>
          <div style={{ fontSize: 13.5, color: '#1B4F8A', fontWeight: 600, marginTop: 2 }}>{p.fTitle}</div>
          <p data-testid="founder-short-bio" style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, color: '#2A3440' }}>{bio}</p>
          {highlights.length > 0 && (
            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {highlights.map((h, i) => <li key={i} style={{ fontSize: 13.5, color: '#2A3440' }}><span style={{ color: GOLD, fontWeight: 800 }}>✓</span> {h}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
            <Link data-testid="founder-full-profile" href={p.fCtaUrl} style={{ color: '#1B4F8A', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Read full profile →</Link>
            {p.fLinkedIn && <a href={p.fLinkedIn} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Connect on LinkedIn →</a>}
          </div>
        </div>
      </div>
    </div>
  );
}
