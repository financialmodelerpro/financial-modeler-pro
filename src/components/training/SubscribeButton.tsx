'use client';

import { useEffect, useRef } from 'react';

interface SubscribeButtonProps {
  channelId: string;
}

export function SubscribeButton({ channelId }: SubscribeButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channelId) return;

    // Load Google platform script once
    if (!document.querySelector('script[src="https://apis.google.com/js/platform.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/platform.js';
      script.async = true;
      document.head.appendChild(script);
    } else {
      // Script already loaded — re-render widgets
      const w = window as unknown as Record<string, unknown>;
      const gapi = w.gapi as { ytsubscribe?: { go?: (el?: Element | null) => void } } | undefined;
      gapi?.ytsubscribe?.go?.(containerRef.current);
    }
  }, [channelId]);

  if (!channelId) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12,
      padding: '20px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
      marginTop: 24,
    }}>
      <div>
        <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Subscribe to our YouTube Channel
        </div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          Get notified when new financial modeling sessions go live
        </div>
      </div>
      <div ref={containerRef}>
        <div
          className="g-ytsubscribe"
          data-channelid={channelId}
          data-layout="default"
          data-count="default"
        />
      </div>
    </div>
  );
}
