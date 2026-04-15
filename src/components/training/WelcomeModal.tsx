'use client';

import { useState, useEffect } from 'react';

const LINKEDIN_URL = 'https://www.linkedin.com/showcase/financialmodelerpro/';
const YT_CHANNEL_ID = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? '';
const YT_URL = `https://www.youtube.com/channel/${YT_CHANNEL_ID}?sub_confirmation=1`;

export function WelcomeModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('fmp_welcomed')) {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    if (typeof localStorage !== 'undefined') localStorage.setItem('fmp_welcomed', 'true');
  }

  if (!show) return null;

  return (
    <>
      <div onClick={dismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#fff', borderRadius: 20, padding: '40px 36px',
        maxWidth: 480, width: '90%', zIndex: 501,
        boxShadow: '0 25px 80px rgba(0,0,0,0.25)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>📐</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 10, lineHeight: 1.3 }}>
          Welcome to Financial Modeler Pro Training
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 28 }}>
          Join our community to get notified when new sessions go live
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          {YT_CHANNEL_ID && (
            <a
              href={YT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 22px', fontSize: 14, fontWeight: 600,
                background: '#FF0000', color: '#fff', borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              🔔 Subscribe on YouTube
            </a>
          )}
          <a
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 22px', fontSize: 14, fontWeight: 600,
              background: '#0077b5', color: '#fff', borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            💼 Follow on LinkedIn
          </a>
        </div>

        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#6b7280',
          }}
        >
          Continue to Training →
        </button>
      </div>
    </>
  );
}
