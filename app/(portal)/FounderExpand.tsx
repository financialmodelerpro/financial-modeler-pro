'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CmsField } from '@/src/components/cms/CmsField';

interface Props {
  label: string;
  longBio: string;
  experience: string[];
  philosophy: string;
  name: string;
  photoUrl?: string;
  photoRadius?: string;
  qualifications?: string;
  bookingUrl?: string;
  bookingText?: string;
}

export function FounderExpand({ label, longBio, experience, philosophy, name, photoUrl, photoRadius, qualifications, bookingUrl, bookingText }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(!open)} style={{ color:'#1ABC9C', background:'none', border:'none', cursor:'pointer', fontSize:'0.95rem', fontWeight:600, padding:0, marginTop:16 }}>
        {open ? '← Collapse' : label}
      </button>
      {open && (
        <div style={{ marginTop:24, borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:24 }}>
          <div style={{ display:'flex', gap:40, flexWrap:'wrap' }}>
            {/* Left column (60%) */}
            <div style={{ flex:'1 1 320px', minWidth:280 }}>
              {longBio && (
                <div style={{ marginBottom:32 }}>
                  <h3 style={{ fontSize:18, fontWeight:800, color:'#fff', marginBottom:16 }}>Background</h3>
                  <CmsField
                    content={{ longBio }}
                    field="longBio"
                    style={{ fontSize:14, color:'rgba(255,255,255,0.85)', lineHeight:1.8 }}
                  />
                </div>
              )}
              {philosophy && (
                <div style={{ padding:24, background:'rgba(0,0,0,0.15)', borderRadius:10, marginBottom:32 }}>
                  <h3 style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:12 }}>Modeling Philosophy</h3>
                  <blockquote style={{ borderLeft:'3px solid #1B4F8A', paddingLeft:20, margin:0, fontSize:15, color:'rgba(255,255,255,0.6)', lineHeight:1.8, fontStyle:'italic' }}>
                    <span>&ldquo;</span>
                    <CmsField content={{ philosophy }} field="philosophy" as="span" />
                    <span>&rdquo;</span>
                  </blockquote>
                  <div style={{ marginTop:12, fontSize:12, color:'rgba(255,255,255,0.35)' }}>- {name}</div>
                </div>
              )}
            </div>
            {/* Right column (40%) */}
            <div style={{ flex:'0 1 300px', minWidth:240 }}>
              {photoUrl && (
                <div style={{ marginBottom:24 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl} alt="" style={{ width:'100%', height:'auto', objectFit:'contain', borderRadius: photoRadius || '12px', display:'block' }} />
                </div>
              )}
              {qualifications && (
                <div style={{ fontSize:'0.85rem', color:'rgba(255,255,255,0.6)', letterSpacing:'0.05em', marginBottom:20 }}>
                  {qualifications}
                </div>
              )}
              {experience.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <h3 style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:12 }}>Experience &amp; Background</h3>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {experience.map((item, i) => (
                      <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                        <span style={{ background:'#1ABC9C', color:'#fff', borderRadius:'50%', width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</span>
                        <CmsField
                          content={{ item }}
                          field="item"
                          as="span"
                          style={{ fontSize:13, color:'rgba(255,255,255,0.85)', lineHeight:1.5, paddingTop:2 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {bookingUrl && (
                <Link href="/book-a-meeting" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1ABC9C', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>
                  📅 {bookingText || 'Book a Meeting'}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
