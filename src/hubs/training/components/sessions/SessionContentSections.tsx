/**
 * A live-course session's content lists (mig 253), in the page order:
 * Overview, What you will learn (Concepts, Hands-on in Excel), Session flow,
 * What you will build, Build with Claude, Before the session, After the
 * session. Every list shows a visible marker: a dot, a check for What you will
 * learn, a number for Session flow. Content comes through sessionSections(),
 * so a session with only the older fields still renders. An empty list is not
 * shown. No hooks, so a server or client parent can render it.
 */
import type { ReactNode } from 'react';
import type { SessionSections } from '@/src/hubs/training/lib/liveCourse/sessionContent';

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const GREEN = '#2E7D52';
const INK = '#2A3440';
const SLATE = '#5A6675';

type Marker = 'bullet' | 'check' | 'number';

function List({ items, marker, testid }: { items: string[]; marker: Marker; testid: string }) {
  return (
    <ol data-testid={testid} data-marker={marker} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {items.map((t, i) => (
        <li key={i} data-testid="session-list-item" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, lineHeight: 1.6, color: INK }}>
          <span aria-hidden data-testid="session-list-marker" style={marker === 'number'
            ? { flexShrink: 0, width: 24, height: 24, marginTop: 1, borderRadius: '50%', background: '#EEF3FA', color: BLUE, fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
            : marker === 'check'
              ? { flexShrink: 0, width: 20, height: 20, marginTop: 3, borderRadius: '50%', background: GREEN, color: '#fff', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
              : { flexShrink: 0, width: 7, height: 7, marginTop: 10, borderRadius: '50%', background: BLUE }}>
            {marker === 'number' ? i + 1 : marker === 'check' ? '✓' : null}
          </span>
          <span style={{ minWidth: 0 }}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

export function SessionContentSections({ sections: s }: { sections: SessionSections }) {
  const block = (title: string, testid: string, body: ReactNode) => (
    <section data-testid={testid} style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>{title}</h2>
      {body}
    </section>
  );
  const sub = (label: string) => <div style={{ fontSize: 12.5, fontWeight: 800, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 8px' }}>{label}</div>;
  // Two groups get their labels; a single group (older content) needs none.
  const twoGroups = s.learnConcepts.length > 0 && s.learnHandsOn.length > 0;

  return (
    <>
      {s.overview.length > 0 && block('Overview', 'course-session-overview', <List items={s.overview} marker="bullet" testid="session-list-overview" />)}
      {(s.learnConcepts.length > 0 || s.learnHandsOn.length > 0) && block('What you will learn', 'course-session-learn', (
        <div style={{ display: 'grid', gap: 14 }}>
          {s.learnConcepts.length > 0 && <div>{twoGroups && sub('Concepts')}<List items={s.learnConcepts} marker="check" testid="session-list-learnConcepts" /></div>}
          {s.learnHandsOn.length > 0 && <div>{twoGroups && sub('Hands-on in Excel')}<List items={s.learnHandsOn} marker="check" testid="session-list-learnHandsOn" /></div>}
        </div>
      ))}
      {s.flow.length > 0 && block('Session flow', 'course-session-flow', <List items={s.flow} marker="number" testid="session-list-flow" />)}
      {s.build.length > 0 && block('What you will build', 'course-session-build', <List items={s.build} marker="bullet" testid="session-list-build" />)}
      {s.claude.length > 0 && block('Build with Claude', 'course-session-claude', <List items={s.claude} marker="bullet" testid="session-list-claude" />)}
      {s.before.length > 0 && block('Before the session', 'course-session-before', <List items={s.before} marker="bullet" testid="session-list-before" />)}
      {s.after.length > 0 && block('After the session', 'course-session-after', <List items={s.after} marker="bullet" testid="session-list-after" />)}
    </>
  );
}
