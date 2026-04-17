'use client';

import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';

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
const MAX_RESULTS = 10; // matches API maxResults

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
        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Discussion</h3>
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
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Discussion</div>
        <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>No comments yet on this session.</div>
        <a
          href={ytCommentsLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8,
            background: '#FAFAFA', border: '1px solid #E5E7EB',
            color: '#DC2626', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}
        >
          Be the first to comment on YouTube <ExternalLink size={13} />
        </a>
      </div>
    );
  }

  // ── Comments list ───────────────────────────────────────────────────────
  const hasMore = comments.length >= MAX_RESULTS;

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>
        Discussion ({comments.length}{hasMore ? '+' : ''} comment{comments.length !== 1 ? 's' : ''})
      </h3>

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

      {/* View all on YouTube (when maxResults hit) */}
      {hasMore && (
        <a
          href={ytCommentsLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', marginBottom: 12 }}
        >
          View all comments on YouTube &rarr;
        </a>
      )}

      {/* Leave a Comment link */}
      <a
        href={ytCommentsLink}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6B7280', textDecoration: 'none', marginBottom: 16 }}
      >
        Leave a Comment &rarr;
      </a>

      {/* Join the Discussion CTA */}
      <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 16, textAlign: 'center' }}>
        <a
          href={ytCommentsLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 8,
            background: '#FAFAFA', border: '1px solid #E5E7EB',
            color: '#DC2626', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#DC2626"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          Join the Discussion on YouTube
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
