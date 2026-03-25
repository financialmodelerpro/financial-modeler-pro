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

export function TestimonialSubmitForm() {
  const [form, setForm] = useState({ name: '', role: '', company: '', text: '', rating: 5 });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function set(field: string, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.text.trim()) {
      setErrorMsg('Name and experience are required.');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/testimonials', {
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
      <div style={{ background:'#fff', borderRadius:16, padding:'48px 40px', textAlign:'center', border:'1px solid #E5E7EB', boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize:48, marginBottom:20 }}>🎉</div>
        <h2 style={{ fontSize:22, fontWeight:800, color:'#1B3A6B', marginBottom:12 }}>Thank You!</h2>
        <p style={{ fontSize:15, color:'#4B5563', lineHeight:1.7, maxWidth:420, margin:'0 auto' }}>
          Your testimonial has been submitted for review. Once approved by our team, it will appear on the site.
        </p>
        <a href="/" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:28, background:'#1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'10px 24px', borderRadius:7, textDecoration:'none' }}>
          Back to Home →
        </a>
      </div>
    );
  }

  return (
    <div style={{ background:'#fff', borderRadius:16, padding:'40px', border:'1px solid #E5E7EB', boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:20 }}>

        {/* Name */}
        <div>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
            Name <span style={{ color:'#EF4444' }}>*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Your full name"
            style={INPUT_STYLE}
            required
          />
        </div>

        {/* Role */}
        <div>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
            Role / Title
          </label>
          <input
            type="text"
            value={form.role}
            onChange={e => set('role', e.target.value)}
            placeholder="e.g. Financial Analyst, Senior Associate"
            style={INPUT_STYLE}
          />
        </div>

        {/* Company */}
        <div>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
            Company / Organization
          </label>
          <input
            type="text"
            value={form.company}
            onChange={e => set('company', e.target.value)}
            placeholder="e.g. PaceMakers, KPMG"
            style={INPUT_STYLE}
          />
        </div>

        {/* Experience */}
        <div>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>
            Your Experience <span style={{ color:'#EF4444' }}>*</span>
          </label>
          <textarea
            value={form.text}
            onChange={e => set('text', e.target.value)}
            placeholder="Tell us how Financial Modeler Pro has helped your work..."
            rows={5}
            style={{ ...INPUT_STYLE, resize:'vertical', lineHeight:1.6 }}
            required
          />
        </div>

        {/* Rating */}
        <div>
          <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:8 }}>
            Rating
          </label>
          <div style={{ display:'flex', gap:8 }}>
            {[1,2,3,4,5].map(star => (
              <button
                key={star}
                type="button"
                onClick={() => set('rating', star)}
                style={{
                  fontSize:28,
                  background:'none',
                  border:'none',
                  cursor:'pointer',
                  color: star <= form.rating ? '#F59E0B' : '#D1D5DB',
                  padding:'2px 4px',
                  transition:'color 0.15s',
                }}
              >
                ★
              </button>
            ))}
            <span style={{ fontSize:13, color:'#6B7280', alignSelf:'center', marginLeft:4 }}>
              {form.rating} / 5
            </span>
          </div>
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
            color:'#fff',
            fontSize:14,
            fontWeight:700,
            padding:'13px 0',
            borderRadius:8,
            border:'none',
            cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            width:'100%',
          }}
        >
          {status === 'loading' ? 'Submitting...' : 'Submit Testimonial →'}
        </button>

        <p style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', margin:0 }}>
          All testimonials are reviewed before publication.
        </p>
      </form>
    </div>
  );
}
