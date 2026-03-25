'use client';

import { useState } from 'react';

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: 14,
  border: '1px solid #D1D5DB',
  borderRadius: 8,
  background: '#FFFBEB',
  color: '#374151',
  outline: 'none',
  boxSizing: 'border-box',
};

export function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setErrorMsg('Name, email, and message are required.');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again.');
    }
  }

  if (status === 'success') {
    return (
      <div style={{ background:'#E8F7EC', border:'1px solid #A3D9AE', borderRadius:12, padding:'32px 28px', textAlign:'center' }}>
        <div style={{ fontSize:36, marginBottom:14 }}>✅</div>
        <h3 style={{ fontSize:18, fontWeight:700, color:'#1A7A30', marginBottom:8 }}>Message Sent!</h3>
        <p style={{ fontSize:14, color:'#374151', lineHeight:1.65 }}>
          Thank you for reaching out. We will get back to you as soon as possible.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div>
        <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Name <span style={{ color:'#EF4444' }}>*</span>
        </label>
        <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your name" style={INPUT_STYLE} required />
      </div>
      <div>
        <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Email <span style={{ color:'#EF4444' }}>*</span>
        </label>
        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com" style={INPUT_STYLE} required />
      </div>
      <div>
        <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Subject
        </label>
        <input type="text" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="How can we help?" style={INPUT_STYLE} />
      </div>
      <div>
        <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Message <span style={{ color:'#EF4444' }}>*</span>
        </label>
        <textarea value={form.message} onChange={e => set('message', e.target.value)} placeholder="Tell us more..." rows={5} style={{ ...INPUT_STYLE, resize:'vertical', lineHeight:1.6 }} required />
      </div>
      {errorMsg && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#DC2626' }}>
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={status === 'loading'}
        style={{
          background: status === 'loading' ? '#9CA3AF' : '#1B4F8A',
          color:'#fff', fontSize:14, fontWeight:700, padding:'13px 0',
          borderRadius:8, border:'none', cursor: status === 'loading' ? 'not-allowed' : 'pointer', width:'100%',
        }}
      >
        {status === 'loading' ? 'Sending...' : 'Send Message →'}
      </button>
    </form>
  );
}
