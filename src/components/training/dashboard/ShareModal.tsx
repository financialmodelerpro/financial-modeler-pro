'use client';

import { useState } from 'react';

interface ShareModalProps {
  label: string;
  certUrl?: string;
  cmsTitle?: string;
  cmsMessageTemplate?: string;
  onClose: () => void;
  onCopyDone: () => void;
}

export function ShareModal({ label, certUrl, cmsTitle, cmsMessageTemplate, onClose, onCopyDone }: ShareModalProps) {
  const pageUrl  = `${process.env.NEXT_PUBLIC_LEARN_URL || 'https://learn.financialmodelerpro.com'}/training`;
  const shareUrl = certUrl || pageUrl;
  const defaultMsg = `I just ${label} at Financial Modeler Pro!\n\nBuilding institutional-grade financial models - Free certification program: ${pageUrl}${certUrl ? `\n\nVerify certificate: ${certUrl}` : ''}\n\n#FinancialModeling #CorporateFinance #FinancialModelerPro`;
  const resolvedMsg = cmsMessageTemplate
    ? cmsMessageTemplate.replace('{action}', label) + (certUrl ? `\n\nVerify certificate: ${certUrl}` : '')
    : defaultMsg;
  const [msg, setMsg] = useState(resolvedMsg);
  const modalTitle = cmsTitle || '🎉 Share Your Achievement';

  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const twUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just ${label} at Financial Modeler Pro! 🏆\n\nFree certification: ${pageUrl}\n\n#FinancialModeling #Finance`)}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => { onCopyDone(); onClose(); }).catch(() => { onCopyDone(); onClose(); });
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '28px 28px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0D2E5A' }}>{modalTitle}</div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={5}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', marginBottom: 18, color: '#374151' }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Share on:</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <a href={liUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#0A66C2', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            in LinkedIn
          </a>
          <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#25D366', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            WhatsApp
          </a>
          <a href={twUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#000', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            𝕏 Twitter/X
          </a>
          <button onClick={copyLink}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            🔗 Copy Link
          </button>
        </div>
        <button onClick={onClose}
          style={{ width: '100%', padding: '9px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, color: '#6B7280', cursor: 'pointer', fontWeight: 600 }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
