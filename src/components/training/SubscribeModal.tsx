'use client';

import { useState, useEffect, useRef } from 'react';

interface SubscribeModalProps {
  channelId: string;
  onClose: () => void;
}

declare global {
  interface Window {
    gapi?: { ytsubscribe?: { go?: () => void } };
  }
}

export function SubscribeModal({ channelId, onClose }: SubscribeModalProps) {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Step 1: Load Google platform script
  useEffect(() => {
    const existing = document.querySelector(
      'script[src="https://apis.google.com/js/platform.js"]'
    );
    if (existing) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/platform.js';
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Step 2: After script loads AND widget div is in DOM, call go()
  useEffect(() => {
    if (!scriptLoaded) return;

    function tryGo() {
      if (window.gapi?.ytsubscribe?.go) {
        window.gapi.ytsubscribe.go();
        setWidgetReady(true);
      }
    }

    // Try immediately, then retry at 300ms and 800ms
    tryGo();
    const t1 = setTimeout(tryGo, 300);
    const t2 = setTimeout(tryGo, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [scriptLoaded]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#ffffff', borderRadius: 16, padding: 32,
        width: 380, maxWidth: 'calc(100vw - 32px)',
        zIndex: 201, boxShadow: '0 25px 80px rgba(0,0,0,0.25)',
        textAlign: 'center',
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af' }}
        >×</button>

        <div style={{ fontSize: 48, marginBottom: 12 }}>📺</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          Subscribe to Financial Modeler Pro
        </h3>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
          Get notified when new financial modeling sessions,
          tutorials, and live training go live on YouTube.
        </p>

        {/* Widget div — always in DOM so go() can find it */}
        <div
          ref={widgetRef}
          style={{
            display: 'flex', justifyContent: 'center',
            marginBottom: 20, minHeight: 40,
            visibility: widgetReady ? 'visible' : 'hidden',
          }}
        >
          <div
            className="g-ytsubscribe"
            data-channelid={channelId}
            data-layout="default"
            data-count="default"
          />
        </div>

        {/* Loading state — shown while widget is invisible */}
        {!widgetReady && (
          <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, marginTop: -60 }}>
            <span style={{ fontSize: 13, color: '#9ca3af' }}>Loading subscribe button...</span>
          </div>
        )}

        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 16, marginTop: 4 }}>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
            Button not showing? You may need to be signed into Google.
          </p>
          <a
            href={`https://www.youtube.com/channel/${channelId}?sub_confirmation=1`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
          >
            Subscribe on YouTube instead →
          </a>
        </div>
      </div>
    </>
  );
}
