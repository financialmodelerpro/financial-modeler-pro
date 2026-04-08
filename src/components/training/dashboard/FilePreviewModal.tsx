'use client';

import { useState } from 'react';

interface Props {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize?: number;
  onClose: () => void;
}

export function FilePreviewModal({ fileName, fileUrl, fileType, fileSize, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const canPreview = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileType);
  const isPdf = fileType === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileType);
  const sizeLabel = fileSize ? fileSize > 1024 * 1024 ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB` : `${(fileSize / 1024).toFixed(0)} KB` : '';

  function handleDownload() {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        background: '#0D2E5A', padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>
            {fileType.toUpperCase()}{sizeLabel ? ` - ${sizeLabel}` : ''} - Financial Modeler Pro Training Hub
          </div>
        </div>
        <button
          onClick={handleDownload}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Download
        </button>
        <button
          onClick={onClose}
          style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'rgba(255,255,255,0.1)', border: 'none',
            color: '#fff', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          x
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {canPreview ? (
          <>
            {loading && (
              <div style={{ position: 'absolute', color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Loading preview...</div>
            )}
            {isPdf && (
              <iframe
                src={`${fileUrl}#toolbar=1&navpanes=0`}
                onLoad={() => setLoading(false)}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                title={fileName}
              />
            )}
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl}
                alt={fileName}
                onLoad={() => setLoading(false)}
                style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: 8, boxShadow: '0 4px 32px rgba(0,0,0,0.3)' }}
              />
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>
              {fileType === 'docx' ? '📝' : fileType === 'pptx' ? '📊' : fileType === 'xlsx' ? '📗' : '📁'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{fileName}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
              Preview is not available for {fileType.toUpperCase()} files
            </div>
            <button
              onClick={handleDownload}
              style={{
                padding: '12px 32px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Download {fileType.toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
