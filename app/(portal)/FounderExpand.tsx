'use client';

import { useState } from 'react';

interface Props {
  label: string;
  longBio: string;
  experience: string[];
  philosophy: string;
  name: string;
}

export function FounderExpand({ label, longBio, experience, philosophy, name }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(!open)} style={{ color:'#1ABC9C', background:'none', border:'none', cursor:'pointer', fontSize:'0.95rem', fontWeight:600, padding:0, marginTop:16 }}>
        {open ? '← Collapse' : label}
      </button>
      {open && (
        <div style={{ marginTop:24, borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:24 }}>
          {longBio && (
            <div style={{ marginBottom:32 }}>
              <h3 style={{ fontSize:18, fontWeight:800, color:'#fff', marginBottom:16 }}>Background</h3>
              {longBio.split('\n\n').map((para, i) => (
                <p key={i} style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.8, marginBottom:16 }}>{para}</p>
              ))}
            </div>
          )}
          {experience.length > 0 && (
            <div style={{ marginBottom:32 }}>
              <h3 style={{ fontSize:18, fontWeight:800, color:'#fff', marginBottom:16 }}>Experience Highlights</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {experience.map((item, i) => (
                  <div key={i} style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                    <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(27,79,138,0.3)', border:'1px solid rgba(27,79,138,0.5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#4A90D9', flexShrink:0, marginTop:1 }}>{i+1}</div>
                    <span style={{ fontSize:14, color:'rgba(255,255,255,0.6)', lineHeight:1.6, paddingTop:3 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {philosophy && (
            <div style={{ padding:'24px', background:'rgba(0,0,0,0.15)', borderRadius:10 }}>
              <h3 style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:12 }}>Modeling Philosophy</h3>
              <blockquote style={{ borderLeft:'3px solid #1B4F8A', paddingLeft:20, margin:0, fontSize:15, color:'rgba(255,255,255,0.6)', lineHeight:1.8, fontStyle:'italic' }}>
                &ldquo;{philosophy}&rdquo;
              </blockquote>
              <div style={{ marginTop:12, fontSize:12, color:'rgba(255,255,255,0.35)' }}>— {name}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
