'use client';

import { useEffect, useRef } from 'react';

interface SubscribeButtonProps {
  channelId: string;
  layout?: 'default' | 'full';
  count?: 'default' | 'hidden';
}

export function SubscribeButton({ channelId, layout, count }: SubscribeButtonProps) {
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
    <div ref={containerRef}>
      <div
        className="g-ytsubscribe"
        data-channelid={channelId}
        data-layout={layout ?? 'default'}
        data-count={count ?? 'default'}
      />
    </div>
  );
}
