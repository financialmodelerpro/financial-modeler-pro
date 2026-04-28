'use client';

interface SubscribeModalProps {
  channelId: string;
  onClose: () => void;
}

export function SubscribeModal({ channelId, onClose }: SubscribeModalProps) {
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
          Get notified when new financial modeling sessions
          and live training go live on YouTube.
        </p>

        <a
          href={`https://www.youtube.com/channel/${channelId}?sub_confirmation=1`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 28px', background: '#FF0000', color: '#ffffff',
            fontSize: 15, fontWeight: 600, borderRadius: 8, textDecoration: 'none',
          }}
        >
          🔔 Subscribe on YouTube
        </a>

        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 12 }}>
          Opens YouTube - takes 2 seconds to subscribe
        </div>
      </div>
    </>
  );
}
