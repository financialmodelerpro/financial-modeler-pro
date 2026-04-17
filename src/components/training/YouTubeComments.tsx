'use client';

import { useState, useEffect } from 'react';

interface Comment {
  id: string;
  author: string;
  authorPhoto: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

type Status = 'ok' | 'empty' | 'error' | 'cached_error';

interface YouTubeCommentsProps {
  videoId: string;
  youtubeUrl: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

const NAVY = '#0D2E5A';

export function YouTubeComments({ videoId, youtubeUrl }: YouTubeCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<Status | 'loading'>('loading');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ytLink = youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`;
  const ytCommentsLink = `${ytLink}${ytLink.includes('#') ? '' : '#comments'}`;

  useEffect(() => {
    fetch(`/api/training/youtube-comments?videoId=${videoId}`)
      .then(r => r.json())
      .then(d => {
        setComments(d.comments ?? []);
        setStatus((d.status as Status) ?? ((d.comments?.length ?? 0) > 0 ? 'ok' : 'empty'));
      })
      .catch(() => {
        setComments([]);
        setStatus('error');
      });
  }, [videoId]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>What others are saying</h3>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#E5E7EB', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ width: 120, height: 14, background: '#E5E7EB', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ width: '100%', height: 12, background: '#F3F4F6', borderRadius: 4, marginBottom: 4 }} />
              <div style={{ width: '70%', height: 12, background: '#F3F4F6', borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error / unavailable ─────────────────────────────────────────────────
  if (status === 'error' || status === 'cached_error') {
    return (
      <div style={{ padding: '16px 0', fontSize: 13, color: '#9CA3AF' }}>
        Comments unavailable right now.{' '}
        <a
          href={ytCommentsLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}
        >
          View on YouTube &rarr;
        </a>
      </div>
    );
  }

  // ── No comments ─────────────────────────────────────────────────────────
  if (comments.length === 0) {
    return (
      <div style={{ padding: '16px 0', fontSize: 13, color: '#9CA3AF' }}>
        No comments yet. Be the first to comment on{' '}
        <a
          href={ytCommentsLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}
        >
          YouTube &rarr;
        </a>
      </div>
    );
  }

  // ── Comments list ───────────────────────────────────────────────────────
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 16 }}>What others are saying</h3>

      {comments.map(c => {
        const isExpanded = expanded.has(c.id);
        return (
          <div key={c.id} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.authorPhoto}
              alt={c.author}
              width={36}
              height={36}
              style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1F2937' }}>{c.author}</span>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>{relativeTime(c.publishedAt)}</span>
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: '#374151',
                  lineHeight: 1.6,
                  ...(isExpanded ? {} : {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                  }),
                }}
                dangerouslySetInnerHTML={{ __html: c.text }}
              />
              {c.text.length > 200 && (
                <button
                  onClick={() => setExpanded(prev => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                    return next;
                  })}
                  style={{ fontSize: 12, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4, fontWeight: 600 }}
                >
                  {isExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
              {c.likeCount > 0 && (
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                  👍 {c.likeCount}
                </div>
              )}
            </div>
          </div>
        );
      })}

    </div>
  );
}
