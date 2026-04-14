'use client';

interface LikeButtonProps {
  youtubeUrl: string;
}

export function LikeButton({ youtubeUrl }: LikeButtonProps) {
  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 20px',
        background: '#f3f4f6',
        color: '#374151',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 14,
        textDecoration: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#e5e7eb')}
      onMouseLeave={e => (e.currentTarget.style.background = '#f3f4f6')}
    >
      👍 Like this video on YouTube
    </a>
  );
}
