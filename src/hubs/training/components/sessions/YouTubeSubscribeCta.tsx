'use client';

/**
 * The live course's YouTube subscribe call to action (founder, 2026-11-13):
 * the session card, the completion screen and the recording page all render
 * this one component, with the link and copy from liveCourse/youtube.ts.
 * It is a plain link: nothing records a click and nothing is gated on it.
 */
import { NEXT_RECORDING_SUBSCRIBE_TEXT, youtubeSubscribeUrl } from '@/src/hubs/training/lib/liveCourse/youtube';

export function YouTubeSubscribeCta({ text = NEXT_RECORDING_SUBSCRIBE_TEXT, compact = false, testid = 'youtube-subscribe-cta' }: {
  text?: string;
  compact?: boolean;
  testid?: string;
}) {
  return (
    <div data-testid={testid} style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
      padding: compact ? '8px 12px' : '12px 16px', marginTop: compact ? 8 : 12,
    }}>
      <span style={{ flex: '1 1 220px', fontSize: 13, color: '#7F1D1D', lineHeight: 1.45 }}>{text}</span>
      <a href={youtubeSubscribeUrl()} target="_blank" rel="noopener noreferrer"
        style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
        ▶ Subscribe on YouTube
      </a>
    </div>
  );
}
