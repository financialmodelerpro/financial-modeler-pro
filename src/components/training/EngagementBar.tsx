'use client';

import { useState } from 'react';

interface EngagementBarProps {
  youtubeUrl: string;
  channelId?: string;
  showLike?: boolean;
}

const CHANNEL_BASE = 'https://www.youtube.com/channel/';

export function EngagementBar({ youtubeUrl, channelId, showLike = true }: EngagementBarProps) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function scrollToComments(e: React.MouseEvent) {
    e.preventDefault();
    document.getElementById('yt-comments')?.scrollIntoView({ behavior: 'smooth' });
  }

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8,
    background: '#F3F4F6', color: '#374151',
    border: '1px solid #E5E7EB',
    fontSize: 13, fontWeight: 600,
    textDecoration: 'none', cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      {showLike && (
        <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" style={btn}>
          👍 Like
        </a>
      )}
      {channelId && (
        <a href={`${CHANNEL_BASE}${channelId}?sub_confirmation=1`} target="_blank" rel="noopener noreferrer" style={btn}>
          🔔 Subscribe
        </a>
      )}
      <button onClick={scrollToComments} style={btn}>
        💬 Comments
      </button>
      <button onClick={copyLink} style={{
        ...btn,
        background: copied ? '#DCFCE7' : '#F3F4F6',
        border: `1px solid ${copied ? '#86EFAC' : '#E5E7EB'}`,
        color: copied ? '#166534' : '#374151',
      }}>
        {copied ? '✓ Copied' : '🔗 Copy Link'}
      </button>
    </div>
  );
}
