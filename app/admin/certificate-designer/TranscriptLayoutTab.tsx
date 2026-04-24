'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';

const PDF_W  = 595;
const SCALE  = 0.72;
const PW     = Math.round(PDF_W * SCALE);
function px(pt: number) { return Math.round(pt * SCALE); }
function p(scr: number) { return scr / SCALE; }

const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const SAMPLE = {
  name: 'Ahmed Al-Rashidi', id: 'FMP-2026-001', email: 'ahmed@example.com',
  course: 'Building a 3-Statement Financial Model', courseShort: '3SFM',
  enrolled: '15 January 2024',
  sessions: [
    { num:'1', name:'Introduction to Financial Modeling', score:'88%', attempts:'1 / 3' },
    { num:'2', name:'Income Statement Modeling',          score:'92%', attempts:'1 / 3' },
    { num:'3', name:'Balance Sheet Mechanics',            score:'85%', attempts:'2 / 3' },
    { num:'4', name:'Cash Flow Statement',                score:'90%', attempts:'1 / 3' },
    { num:'5', name:'Three-Statement Integration',        score:'78%', attempts:'2 / 3' },
    { num:'6', name:'Scenario Analysis & Sensitivity',    score:'95%', attempts:'1 / 3' },
  ],
  final: { score:'89%', attempts:'1 / 2' },
  certId: 'FMP-3SFM-2026-0001', certIssued: '20 March 2026',
  verifyUrl: 'https://learn.financialmodelerpro.com/verify/FMP-3SFM-2026-0001',
};

interface Settings {
  headerBgColor: string;
  headerHeight:  number;
  logoUrl: string; logoX: number; logoY: number; logoWidth: number; logoHeight: number; logoVisible: boolean;
  brandText: string; brandX: number; brandY: number; brandVisible: boolean;
  titleText: string; titleX: number; titleY: number; titleVisible: boolean;
  subtitleText: string; subtitleX: number; subtitleY: number; subtitleVisible: boolean;
  instructorText: string; instructorX: number; instructorY: number; instructorVisible: boolean;
  websiteText: string; websiteX: number; websiteY: number; websiteVisible: boolean;
  tableHeaderColor: string;
  studentStripBg:   string;
  passedBg: string; passedColor: string;
  failedBg: string; failedColor: string;
  colNum: string; colSession: string; colScore: string; colStatus: string; colAttempts: string;
  bannerCompleteTitle: string; bannerCompleteSub: string;
  bannerProgressTitle: string; bannerProgressSub: string;
  footerBgColor:   string;
  footerLeftText:  string; footerLeftVisible:   boolean;
  footerMidText:   string; footerMidVisible:    boolean;
  footerRightText: string; footerRightVisible:  boolean;
}

const D: Settings = {
  headerBgColor: '#0D2E5A', headerHeight: 80,
  logoUrl: '', logoX: 520, logoY: 14, logoWidth: 40, logoHeight: 40, logoVisible: true,
  brandText: 'Financial Modeler Pro', brandX: 36, brandY: 18, brandVisible: true,
  titleText: 'OFFICIAL ACADEMIC TRANSCRIPT', titleX: 36, titleY: 56, titleVisible: true,
  subtitleText: 'FMP Training Hub', subtitleX: 455, subtitleY: 60, subtitleVisible: true,
  instructorText: 'Ahmad Din | Corporate Finance Expert', instructorX: 36, instructorY: 31, instructorVisible: true,
  websiteText: 'www.financialmodelerpro.com', websiteX: 36, websiteY: 41, websiteVisible: true,
  tableHeaderColor: '#1B4F8A', studentStripBg: '#EBF3FC',
  passedBg: '#D1FAE5', passedColor: '#065F46',
  failedBg: '#FEE2E2', failedColor: '#991B1B',
  colNum: '#', colSession: 'Session Name', colScore: 'Score', colStatus: 'Status', colAttempts: 'Attempts',
  bannerCompleteTitle: '✓ OFFICIAL TRANSCRIPT - Course Complete',
  bannerCompleteSub:   'All requirements fulfilled. Certificate issued as of [date].',
  bannerProgressTitle: 'PROGRESS TRANSCRIPT - Course in Progress',
  bannerProgressSub:   'This transcript reflects current progress as of [date]. A final transcript will be issued upon course completion.',
  footerBgColor: '#0D2E5A',
  footerLeftText: 'Issue Date: [date]', footerLeftVisible: true,
  footerMidText:  'This transcript is an official record issued by Financial Modeler Pro.', footerMidVisible: true,
  footerRightText: 'www.financialmodelerpro.com', footerRightVisible: true,
};

const K: Record<keyof Settings, string> = {
  headerBgColor:'transcript_header_bg', headerHeight:'transcript_header_h',
  logoUrl:'transcript_logo_url', logoX:'transcript_logo_x', logoY:'transcript_logo_y', logoWidth:'transcript_logo_w', logoHeight:'transcript_logo_h', logoVisible:'transcript_logo_vis',
  brandText:'transcript_brand_t', brandX:'transcript_brand_x', brandY:'transcript_brand_y', brandVisible:'transcript_brand_vis',
  titleText:'transcript_title_t', titleX:'transcript_title_x', titleY:'transcript_title_y', titleVisible:'transcript_title_vis',
  subtitleText:'transcript_sub_t', subtitleX:'transcript_sub_x', subtitleY:'transcript_sub_y', subtitleVisible:'transcript_sub_vis',
  instructorText:'transcript_instr_t', instructorX:'transcript_instr_x', instructorY:'transcript_instr_y', instructorVisible:'transcript_instr_vis',
  websiteText:'transcript_web_t', websiteX:'transcript_web_x', websiteY:'transcript_web_y', websiteVisible:'transcript_web_vis',
  tableHeaderColor:'transcript_tbl_hdr', studentStripBg:'transcript_strip_bg',
  passedBg:'transcript_pass_bg', passedColor:'transcript_pass_color',
  failedBg:'transcript_fail_bg', failedColor:'transcript_fail_color',
  colNum:'transcript_col_num', colSession:'transcript_col_sess', colScore:'transcript_col_score',
  colStatus:'transcript_col_status', colAttempts:'transcript_col_att',
  bannerCompleteTitle:'transcript_ban_ctitle', bannerCompleteSub:'transcript_ban_csub',
  bannerProgressTitle:'transcript_ban_ptitle', bannerProgressSub:'transcript_ban_psub',
  footerBgColor:'transcript_footer_bg',
  footerLeftText:'transcript_fl_t', footerLeftVisible:'transcript_fl_vis',
  footerMidText:'transcript_fm_t', footerMidVisible:'transcript_fm_vis',
  footerRightText:'transcript_fr_t', footerRightVisible:'transcript_fr_vis',
};

type ElemKey = 'logo'|'brand'|'title'|'subtitle'|'instructor'|'website';
const ELEMS: { key: ElemKey; label: string }[] = [
  { key:'logo',       label:'Logo' },
  { key:'brand',      label:'Brand Name' },
  { key:'title',      label:'Document Title' },
  { key:'subtitle',   label:'Subtitle Badge' },
  { key:'instructor', label:'Instructor Line' },
  { key:'website',    label:'Website URL' },
];

function getPos(cfg: Settings, k: ElemKey) {
  return { x: cfg[`${k}X` as keyof Settings] as number, y: cfg[`${k}Y` as keyof Settings] as number };
}
function getVisible(cfg: Settings, k: ElemKey): boolean {
  return cfg[`${k}Visible` as keyof Settings] as boolean;
}

interface HeaderCanvasProps {
  cfg: Settings;
  selected: ElemKey | null;
  onSelect: (k: ElemKey) => void;
  onMove: (k: ElemKey, x: number, y: number) => void;
}

function HeaderCanvas({ cfg, selected, onSelect, onMove }: HeaderCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ key: ElemKey; sx: number; sy: number; ix: number; iy: number } | null>(null);

  const startDrag = useCallback((e: React.MouseEvent, key: ElemKey, ix: number, iy: number) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(key);
    dragRef.current = { key, sx: e.clientX, sy: e.clientY, ix, iy };

    function onMove2(ev: MouseEvent) {
      if (!dragRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const dx = ev.clientX - dragRef.current.sx;
      const dy = ev.clientY - dragRef.current.sy;
      const nx = Math.max(0, Math.min(PDF_W - 10, dragRef.current.ix + p(dx)));
      const ny = Math.max(0, Math.min(p(rect.height) - 4, dragRef.current.iy + p(dy)));
      onMove(dragRef.current.key, Math.round(nx), Math.round(ny));
    }
    function onUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove2);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove2);
    document.addEventListener('mouseup', onUp);
  }, [onSelect, onMove]);

  const sel: React.CSSProperties = { outline: '2px dashed rgba(255,200,0,0.9)', outlineOffset: 2 };

  return (
    <div ref={canvasRef} onClick={() => onSelect('brand')} style={{ position:'relative', width:PW, height:px(cfg.headerHeight), background:cfg.headerBgColor, overflow:'hidden', flexShrink:0 }}>
      {cfg.logoVisible && cfg.logoUrl && (
        <div onMouseDown={e => startDrag(e,'logo',cfg.logoX,cfg.logoY)}
          style={{ position:'absolute', left:px(cfg.logoX), top:px(cfg.logoY), cursor:'grab', userSelect:'none', ...(selected==='logo' ? sel : {}) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cfg.logoUrl} alt="Logo" style={{ width:px(cfg.logoWidth), height:px(cfg.logoHeight), objectFit:'contain', display:'block' }} />
        </div>
      )}
      {cfg.brandVisible && cfg.brandText && (
        <div onMouseDown={e => startDrag(e,'brand',cfg.brandX,cfg.brandY)}
          style={{ position:'absolute', left:px(cfg.brandX), top:px(cfg.brandY), cursor:'grab', userSelect:'none', fontSize:px(11), fontWeight:800, color:'#fff', whiteSpace:'nowrap', ...(selected==='brand' ? sel : {}) }}>
          {cfg.brandText}
        </div>
      )}
      {cfg.instructorVisible && cfg.instructorText && (
        <div onMouseDown={e => startDrag(e,'instructor',cfg.instructorX,cfg.instructorY)}
          style={{ position:'absolute', left:px(cfg.instructorX), top:px(cfg.instructorY), cursor:'grab', userSelect:'none', fontSize:px(7), color:'rgba(255,255,255,0.55)', whiteSpace:'nowrap', ...(selected==='instructor' ? sel : {}) }}>
          {cfg.instructorText}
        </div>
      )}
      {cfg.websiteVisible && cfg.websiteText && (
        <div onMouseDown={e => startDrag(e,'website',cfg.websiteX,cfg.websiteY)}
          style={{ position:'absolute', left:px(cfg.websiteX), top:px(cfg.websiteY), cursor:'grab', userSelect:'none', fontSize:px(7), color:'rgba(255,255,255,0.55)', whiteSpace:'nowrap', ...(selected==='website' ? sel : {}) }}>
          {cfg.websiteText}
        </div>
      )}
      {cfg.titleVisible && cfg.titleText && (
        <div onMouseDown={e => startDrag(e,'title',cfg.titleX,cfg.titleY)}
          style={{ position:'absolute', left:px(cfg.titleX), top:px(cfg.titleY), cursor:'grab', userSelect:'none', fontSize:px(9), fontWeight:800, color:'#90CAF9', letterSpacing:'1.2px', whiteSpace:'nowrap', ...(selected==='title' ? sel : {}) }}>
          {cfg.titleText}
        </div>
      )}
      {cfg.subtitleVisible && cfg.subtitleText && (
        <div onMouseDown={e => startDrag(e,'subtitle',cfg.subtitleX,cfg.subtitleY)}
          style={{ position:'absolute', left:px(cfg.subtitleX), top:px(cfg.subtitleY), cursor:'grab', userSelect:'none', background:'rgba(255,255,255,0.12)', borderRadius:px(4), padding:`${px(3)}px ${px(7)}px`, ...(selected==='subtitle' ? sel : {}) }}>
          <span style={{ fontSize:px(7.5), fontWeight:800, color:'rgba(255,255,255,0.8)', whiteSpace:'nowrap' }}>{cfg.subtitleText}</span>
        </div>
      )}
      {cfg.logoVisible && !cfg.logoUrl && (
        <div style={{ position:'absolute', left:px(cfg.logoX), top:px(cfg.logoY), width:px(cfg.logoWidth), height:px(cfg.logoHeight), border:'1px dashed rgba(255,255,255,0.3)', borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:px(7), color:'rgba(255,255,255,0.4)' }}>Logo</span>
        </div>
      )}
      <div style={{ position:'absolute', bottom:3, right:6, fontSize:9, color:'rgba(255,255,255,0.25)', pointerEvents:'none' }}>drag to reposition</div>
    </div>
  );
}

function BodyPreview({ cfg }: { cfg: Settings }) {
  return (
    <>
      <div style={{ background:cfg.studentStripBg, padding:`${px(10)}px ${px(36)}px`, display:'flex', gap:px(12) }}>
        <div style={{ flex:1 }}>
          {[['Student Name',SAMPLE.name,true],['Registration ID',SAMPLE.id,false],['Email',SAMPLE.email,false]].map(([l,v,b])=>(
            <div key={String(l)} style={{ display:'flex', marginBottom:px(3) }}>
              <span style={{ fontSize:px(8), fontWeight:800, color:'#1B4F8A', width:px(100), flexShrink:0 }}>{l}</span>
              <span style={{ fontSize:px(8.5), color:'#111827', fontWeight:b?800:400 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ flex:1 }}>
          {[['Course',SAMPLE.courseShort,true],['Enrollment Date',SAMPLE.enrolled,false],['Issue Date',TODAY,false]].map(([l,v,b])=>(
            <div key={String(l)} style={{ display:'flex', marginBottom:px(3) }}>
              <span style={{ fontSize:px(8), fontWeight:800, color:'#1B4F8A', width:px(100), flexShrink:0 }}>{l}</span>
              <span style={{ fontSize:px(8.5), color:'#111827', fontWeight:b?800:400 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background:'#F0FFF4', padding:`${px(6)}px ${px(36)}px`, borderTop:'1px solid #BBF7D0', borderBottom:'1px solid #BBF7D0' }}>
        <div style={{ fontSize:px(9), fontWeight:800, color:'#166534' }}>{cfg.bannerCompleteTitle}</div>
        <div style={{ fontSize:px(8), color:'#166534', marginTop:px(2) }}>{cfg.bannerCompleteSub.replace('[date]',TODAY)}</div>
      </div>
      <div style={{ padding:`${px(12)}px ${px(36)}px ${px(5)}px`, display:'flex', alignItems:'center' }}>
        <span style={{ fontSize:px(10), fontWeight:800, color:'#0D2E5A', marginRight:px(8), whiteSpace:'nowrap' }}>{SAMPLE.course}</span>
        <div style={{ flex:1, height:1, background:'#E5E7EB' }} />
      </div>
      <div style={{ padding:`0 ${px(36)}px` }}>
        <div style={{ display:'flex', background:cfg.tableHeaderColor, padding:`${px(5)}px 0`, borderRadius:px(4) }}>
          {[cfg.colNum,cfg.colSession,cfg.colScore,cfg.colStatus,cfg.colAttempts].map((lbl,i)=>(
            <div key={i} style={i===0?{width:px(28),paddingLeft:px(6)}:i===1?{flex:1,paddingLeft:px(6)}:i===2?{width:px(46),textAlign:'center' as const}:i===3?{width:px(76),paddingLeft:px(4)}:{width:px(52),textAlign:'center' as const}}>
              <span style={{ fontSize:px(8), fontWeight:800, color:'#fff' }}>{lbl}</span>
            </div>
          ))}
        </div>
        {SAMPLE.sessions.map((sess,idx)=>(
          <div key={sess.num} style={{ display:'flex', borderBottom:'1px solid #E5E7EB', padding:`${px(4)}px 0`, background:idx%2===1?'#F9FAFB':'#fff' }}>
            <div style={{ width:px(28),paddingLeft:px(6) }}><span style={{ fontSize:px(8),color:'#6B7280' }}>{sess.num}</span></div>
            <div style={{ flex:1,paddingLeft:px(6) }}><span style={{ fontSize:px(8.5) }}>{sess.name}</span></div>
            <div style={{ width:px(46),textAlign:'center' }}><span style={{ fontSize:px(8.5),fontWeight:800 }}>{sess.score}</span></div>
            <div style={{ width:px(76),paddingLeft:px(4) }}><span style={{ background:cfg.passedBg,borderRadius:px(3),padding:`${px(2)}px ${px(5)}px`,fontSize:px(7.5),fontWeight:800,color:cfg.passedColor }}>PASSED</span></div>
            <div style={{ width:px(52),textAlign:'center' }}><span style={{ fontSize:px(8.5) }}>{sess.attempts}</span></div>
          </div>
        ))}
        <div style={{ display:'flex', borderBottom:'1px solid #E5E7EB', padding:`${px(4)}px 0`, background:'#FDF3DC' }}>
          <div style={{ width:px(28),paddingLeft:px(6) }}><span style={{ fontSize:px(7.5),fontWeight:800,color:'#C9A84C' }}>FINAL</span></div>
          <div style={{ flex:1,paddingLeft:px(6) }}><div style={{ fontSize:px(8.5),fontWeight:800 }}>Final Comprehensive Exam</div><div style={{ fontSize:px(7),color:'#6B7280',marginTop:px(2) }}>50 questions · Pass mark 70%</div></div>
          <div style={{ width:px(46),textAlign:'center' }}><span style={{ fontSize:px(8.5),fontWeight:800 }}>{SAMPLE.final.score}</span></div>
          <div style={{ width:px(76),paddingLeft:px(4) }}><span style={{ background:cfg.passedBg,borderRadius:px(3),padding:`${px(2)}px ${px(5)}px`,fontSize:px(7.5),fontWeight:800,color:cfg.passedColor }}>PASSED</span></div>
          <div style={{ width:px(52),textAlign:'center' }}><span style={{ fontSize:px(8.5) }}>{SAMPLE.final.attempts}</span></div>
        </div>
        <div style={{ display:'flex', borderBottom:'1px solid #E5E7EB', padding:`${px(4)}px 0` }}>
          <div style={{ width:px(28),paddingLeft:px(6) }}><span style={{ fontSize:px(8),color:'#9CA3AF' }}>-</span></div>
          <div style={{ flex:1,paddingLeft:px(6) }}><span style={{ fontSize:px(8),color:'#9CA3AF',fontStyle:'italic' }}>Failed attempt (badge preview)</span></div>
          <div style={{ width:px(46),textAlign:'center' }}><span style={{ fontSize:px(8.5),fontWeight:800 }}>55%</span></div>
          <div style={{ width:px(76),paddingLeft:px(4) }}><span style={{ background:cfg.failedBg,borderRadius:px(3),padding:`${px(2)}px ${px(5)}px`,fontSize:px(7.5),fontWeight:800,color:cfg.failedColor }}>FAILED</span></div>
          <div style={{ width:px(52),textAlign:'center' }}><span style={{ fontSize:px(8.5) }}>3 / 3</span></div>
        </div>
      </div>
      <div style={{ display:'flex', gap:px(12), padding:`${px(10)}px ${px(36)}px ${px(10)}px` }}>
        <div style={{ flex:1, border:'1.5px solid #1B4F8A', borderRadius:px(6), padding:px(10) }}>
          <div style={{ fontSize:px(8.5),fontWeight:800,color:'#0D2E5A',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:px(10) }}>Academic Summary - {SAMPLE.courseShort}</div>
          {[['Sessions Passed','6 of 6'],['Average Score','88%'],['Final Exam','89%'],['Overall Result','PASSED']].map(([l,v])=>(
            <div key={l} style={{ display:'flex',justifyContent:'space-between',marginBottom:px(4) }}>
              <span style={{ fontSize:px(8),color:'#6B7280' }}>{l}</span>
              <span style={{ fontSize:px(8),fontWeight:800,color:l==='Overall Result'?cfg.passedColor:'#111827' }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ flex:1, border:'1.5px solid #2EAA4A', borderRadius:px(6), padding:px(10) }}>
          <div style={{ fontSize:px(8.5),fontWeight:800,color:'#0D2E5A',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:px(10) }}>Certification Status</div>
          {[['Status','CERTIFIED'],['Certificate ID',SAMPLE.certId],['Completion Date',SAMPLE.certIssued]].map(([l,v])=>(
            <div key={l} style={{ display:'flex',justifyContent:'space-between',marginBottom:px(4) }}>
              <span style={{ fontSize:px(8),color:'#6B7280' }}>{l}</span>
              <span style={{ fontSize:px(8),fontWeight:800,fontFamily:l==='Certificate ID'?'monospace':'inherit',color:l==='Status'?'#2EAA4A':'#111827' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ margin:`0 ${px(36)}px ${px(14)}px`, border:'1.5px solid #1B4F8A', borderRadius:px(6), padding:`${px(10)}px ${px(14)}px`, display:'flex', alignItems:'center', gap:px(14), background:'#F0F7FF' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(SAMPLE.verifyUrl)}`}
          alt="QR Code"
          style={{ width:px(70), height:px(70), borderRadius:px(4), border:'1px solid #E5E7EB', flexShrink:0 }}
        />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:px(9), fontWeight:800, color:'#0D2E5A', marginBottom:px(2) }}>Verify Certificate</div>
          <div style={{ fontSize:px(7.5), color:'#6B7280', marginBottom:px(6) }}>Scan QR code or use the link below</div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:px(4), fontSize:px(8), fontWeight:700, color:'#1B4F8A', border:'1.5px solid #1B4F8A', borderRadius:px(4), padding:`${px(3)}px ${px(8)}px`, background:'#fff' }}>
            Verify Certificate ↗
          </div>
          <div style={{ marginTop:px(4), fontSize:px(7), color:'#9CA3AF', wordBreak:'break-all', lineHeight:1.4 }}>{SAMPLE.verifyUrl}</div>
        </div>
      </div>
    </>
  );
}

function FooterPreview({ cfg }: { cfg: Settings }) {
  const parts = [
    { text: cfg.footerLeftText.replace('[date]', TODAY),  vis: cfg.footerLeftVisible },
    { text: cfg.footerMidText,  vis: cfg.footerMidVisible },
    { text: cfg.footerRightText, vis: cfg.footerRightVisible },
  ].filter(p => p.vis && p.text);
  return (
    <div style={{ background:cfg.footerBgColor, padding:`${px(7)}px ${px(36)}px`, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
      {parts.map((p,i)=>(
        <span key={i} style={{ fontSize:px(7), color:'rgba(255,255,255,0.55)', flex: i===1?1:undefined, textAlign: i===1?'center':undefined }}>{p.text}</span>
      ))}
    </div>
  );
}

const IS: React.CSSProperties = { width:'100%', padding:'6px 10px', fontSize:13, borderRadius:6, border:'1px solid #D1D5DB', background:'#F9FAFB', color:'#111827', outline:'none', boxSizing:'border-box' };
const LS: React.CSSProperties = { fontSize:11, fontWeight:700, color:'#374151', display:'block', marginBottom:3 };

function F({ label, value, onChange, multi }: { label:string; value:string; onChange:(v:string)=>void; multi?:boolean }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={LS}>{label}</label>
      {multi ? <textarea style={{ ...IS, resize:'vertical', minHeight:48 }} value={value} onChange={e=>onChange(e.target.value)} />
             : <input style={IS} value={value} onChange={e=>onChange(e.target.value)} />}
    </div>
  );
}
function C({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={LS}>{label}</label>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <input type="color" value={value} onChange={e=>onChange(e.target.value)} style={{ width:36,height:30,border:'1px solid #D1D5DB',borderRadius:6,cursor:'pointer',padding:2,flexShrink:0 }} />
        <input style={{ ...IS, flex:1 }} value={value} onChange={e=>onChange(e.target.value)} />
      </div>
    </div>
  );
}
function Sep({ label }: { label:string }) {
  return (
    <>
      <hr style={{ border:'none', borderTop:'1px solid #E5E7EB', margin:'6px 0 14px' }} />
      <div style={{ fontSize:11, fontWeight:800, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>{label}</div>
    </>
  );
}

export function TranscriptLayoutTab() {
  const [cfg, setCfg]       = useState<Settings>(D);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast]   = useState('');
  const [selected, setSelected] = useState<ElemKey>('brand');

  useEffect(() => {
    fetch('/api/admin/content?section=transcript')
      .then(r => r.json())
      .then((data: { rows?: { key: string; value: string }[] }) => {
        const rows = Array.isArray(data) ? data : (data?.rows ?? []);
        if (!rows.length) return;
        const map: Record<string,string> = {};
        for (const r of rows) map[r.key] = r.value;
        setCfg(prev => {
          const next = { ...prev };
          (Object.keys(K) as (keyof Settings)[]).forEach(k => {
            const raw = map[K[k]];
            if (raw === undefined || raw === null) return;
            const def = D[k];
            if (typeof def === 'number') { const n = parseFloat(raw); if (Number.isFinite(n)) (next as Record<string,unknown>)[k] = n; }
            else if (typeof def === 'boolean') (next as Record<string,unknown>)[k] = raw === 'true';
            else (next as Record<string,unknown>)[k] = raw;
          });
          return next;
        });
      }).catch(()=>{});
  }, []);

  async function save() {
    setSaving(true); setToast('');
    try {
      await Promise.all((Object.keys(cfg) as (keyof Settings)[]).map(k =>
        fetch('/api/admin/content', { method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ section:'transcript', key:K[k], value:String(cfg[k]) }) })
      ));
      showToast('Saved.');
    } catch { showToast('Save failed.'); }
    finally { setSaving(false); }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(()=>setToast(''), 3000); }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('bucket', 'cms-assets');
      const res = await fetch('/api/admin/media', { method:'POST', body:fd });
      const j = await res.json();
      if (j.url) set('logoUrl', j.url); else showToast(j.error ?? 'Upload failed.');
    } catch { showToast('Upload failed.'); }
    finally { setUploading(false); }
  }

  function set<K2 extends keyof Settings>(key: K2, val: Settings[K2]) { setCfg(p => ({ ...p, [key]: val })); }
  function moveElem(k: ElemKey, x: number, y: number) {
    setCfg(p => ({ ...p, [`${k}X`]: x, [`${k}Y`]: y }));
  }
  function toggleVisible(k: ElemKey) {
    const vk = `${k}Visible` as keyof Settings;
    setCfg(p => ({ ...p, [vk]: !p[vk] }));
  }
  function deleteElem(k: ElemKey) {
    const vk = `${k}Visible` as keyof Settings;
    const tk = k === 'logo' ? 'logoUrl' : `${k}Text` as keyof Settings;
    setCfg(p => ({ ...p, [vk]: false, [tk]: '' }));
  }

  const selElem = ELEMS.find(e => e.key === selected)!;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background: '#F3F4F6' }}>

      {/* Local toolbar */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E5E7EB', padding:'12px 20px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <p style={{ fontSize:12, color:'#6B7280', margin: 0, flex: 1 }}>Drag elements in the header. Click to select and edit.</p>
        {toast && <span style={{ fontSize:12, color:toast.includes('fail')||toast.includes('Failed')?'#DC2626':'#2EAA4A', fontWeight:600 }}>{toast}</span>}
        <button onClick={()=>setCfg(D)} style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #D1D5DB', background:'#fff', fontSize:12, cursor:'pointer' }}>Reset</button>
        <a href="/api/training/transcript?preview=true" target="_blank" rel="noopener noreferrer"
          style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #1B4F8A', background:'#EFF6FF', fontSize:12, color:'#1B4F8A', textDecoration:'none' }}>PDF Preview ↗</a>
        <button onClick={save} disabled={saving}
          style={{ padding:'6px 16px', borderRadius:7, background:saving?'#9CA3AF':'#0D2E5A', color:'#fff', border:'none', fontSize:13, fontWeight:700, cursor:saving?'default':'pointer' }}>
          {saving?'Saving…':'Save'}
        </button>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left panel */}
        <div style={{ width:300, background:'#fff', borderRight:'1px solid #E5E7EB', overflowY:'auto', padding:18 }}>

          <div style={{ fontSize:11, fontWeight:800, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Header Elements</div>
          <div style={{ marginBottom:14 }}>
            {ELEMS.map(({ key, label }) => {
              const vis = getVisible(cfg, key);
              const isSel = selected === key;
              return (
                <div key={key} onClick={()=>setSelected(key)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:6, marginBottom:3, cursor:'pointer', background:isSel?'#EFF6FF':'transparent', border:isSel?'1px solid #BFDBFE':'1px solid transparent' }}>
                  <span style={{ fontSize:13 }}>
                    {key==='logo'?'🖼️':key==='brand'?'🏷️':key==='title'?'📝':key==='subtitle'?'🔖':key==='instructor'?'👤':'🌐'}
                  </span>
                  <span style={{ flex:1, fontSize:12, fontWeight:isSel?700:500, color:vis?'#111827':'#9CA3AF' }}>{label}</span>
                  <button onClick={e=>{e.stopPropagation();toggleVisible(key);}} title={vis?'Hide':'Show'}
                    style={{ padding:'2px 4px', borderRadius:4, border:'none', background:'transparent', cursor:'pointer', fontSize:12, color:vis?'#6B7280':'#D1D5DB' }}>
                    {vis?'👁':'👁‍🗨'}
                  </button>
                  <button onClick={e=>{e.stopPropagation();deleteElem(key);}} title="Delete (clears text)"
                    style={{ padding:'2px 4px', borderRadius:4, border:'none', background:'transparent', cursor:'pointer', fontSize:12, color:'#FCA5A5' }}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ background:'#F9FAFB', borderRadius:8, padding:12, marginBottom:14, border:'1px solid #E5E7EB' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#1B4F8A', marginBottom:10 }}>Editing: {selElem.label}</div>
            {selected === 'logo' ? (
              <>
                {cfg.logoUrl && (
                  <div style={{ marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cfg.logoUrl} alt="" style={{ height:36, objectFit:'contain', border:'1px solid #E5E7EB', borderRadius:4, padding:2, background:'#fff' }} />
                    <button onClick={()=>set('logoUrl','')} style={{ padding:'3px 8px', borderRadius:5, border:'1px solid #FCA5A5', background:'#FEF2F2', fontSize:11, cursor:'pointer', color:'#DC2626' }}>Remove</button>
                  </div>
                )}
                <label style={{ display:'block', padding:'6px 10px', borderRadius:6, border:'1px solid #D1D5DB', background:'#fff', fontSize:12, cursor:'pointer', textAlign:'center', color:'#374151', marginBottom:6 }}>
                  {uploading?'Uploading…':'↑ Upload Logo'}
                  <input type="file" accept="image/*" style={{ display:'none' }} disabled={uploading} onChange={e=>{if(e.target.files?.[0]) uploadLogo(e.target.files[0]);}} />
                </label>
                <input style={{ ...IS, marginBottom:8 }} placeholder="or paste URL…" value={cfg.logoUrl} onChange={e=>set('logoUrl',e.target.value)} />
                <label style={LS}>Width: {cfg.logoWidth} pt</label>
                <input type="range" min={16} max={120} value={cfg.logoWidth} onChange={e=>set('logoWidth',parseInt(e.target.value))} style={{ width:'100%', marginBottom:8 }} />
                <label style={LS}>Height: {cfg.logoHeight} pt</label>
                <input type="range" min={10} max={100} value={cfg.logoHeight} onChange={e=>set('logoHeight',parseInt(e.target.value))} style={{ width:'100%', marginBottom:8 }} />
              </>
            ) : (
              <F label="Text" value={cfg[`${selected}Text` as keyof Settings] as string} onChange={v=>set(`${selected}Text` as keyof Settings, v as never)} />
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div>
                <label style={LS}>X (PDF pt)</label>
                <input type="number" style={IS} value={getPos(cfg,selected).x} onChange={e=>setCfg(p=>({...p,[`${selected}X`]:parseInt(e.target.value)||0}))} />
              </div>
              <div>
                <label style={LS}>Y (PDF pt)</label>
                <input type="number" style={IS} value={getPos(cfg,selected).y} onChange={e=>setCfg(p=>({...p,[`${selected}Y`]:parseInt(e.target.value)||0}))} />
              </div>
            </div>
          </div>

          <C label="Header Background" value={cfg.headerBgColor} onChange={v=>set('headerBgColor',v)} />
          <div style={{ marginBottom:12 }}>
            <label style={LS}>Header Height: {cfg.headerHeight} pt</label>
            <input type="range" min={50} max={140} value={cfg.headerHeight} onChange={e=>set('headerHeight',parseInt(e.target.value))} style={{ width:'100%' }} />
          </div>

          <Sep label="Body Colors" />
          <C label="Table Header" value={cfg.tableHeaderColor} onChange={v=>set('tableHeaderColor',v)} />
          <C label="Student Strip Background" value={cfg.studentStripBg} onChange={v=>set('studentStripBg',v)} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <C label="Passed Bg" value={cfg.passedBg} onChange={v=>set('passedBg',v)} />
            <C label="Passed Text" value={cfg.passedColor} onChange={v=>set('passedColor',v)} />
            <C label="Failed Bg" value={cfg.failedBg} onChange={v=>set('failedBg',v)} />
            <C label="Failed Text" value={cfg.failedColor} onChange={v=>set('failedColor',v)} />
          </div>

          <Sep label="Column Headers" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <F label="#" value={cfg.colNum} onChange={v=>set('colNum',v)} />
            <F label="Session" value={cfg.colSession} onChange={v=>set('colSession',v)} />
            <F label="Score" value={cfg.colScore} onChange={v=>set('colScore',v)} />
            <F label="Status" value={cfg.colStatus} onChange={v=>set('colStatus',v)} />
            <F label="Attempts" value={cfg.colAttempts} onChange={v=>set('colAttempts',v)} />
          </div>

          <Sep label="Status Banners" />
          <F label="Complete - Title" value={cfg.bannerCompleteTitle} onChange={v=>set('bannerCompleteTitle',v)} />
          <F label="Complete - Subtitle ([date])" value={cfg.bannerCompleteSub} onChange={v=>set('bannerCompleteSub',v)} multi />
          <F label="In Progress - Title" value={cfg.bannerProgressTitle} onChange={v=>set('bannerProgressTitle',v)} />
          <F label="In Progress - Subtitle ([date])" value={cfg.bannerProgressSub} onChange={v=>set('bannerProgressSub',v)} multi />

          <Sep label="Footer" />
          <C label="Footer Background" value={cfg.footerBgColor} onChange={v=>set('footerBgColor',v)} />
          {[
            { label:'Left text ([date])', textKey:'footerLeftText', visKey:'footerLeftVisible' },
            { label:'Center text', textKey:'footerMidText',  visKey:'footerMidVisible' },
            { label:'Right text', textKey:'footerRightText', visKey:'footerRightVisible' },
          ].map(({ label, textKey, visKey }) => (
            <div key={textKey} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <label style={{ ...LS, marginBottom:0, flex:1 }}>{label}</label>
                <button onClick={()=>set(visKey as keyof Settings, (!cfg[visKey as keyof Settings]) as never)}
                  style={{ padding:'2px 6px', borderRadius:4, border:'1px solid #D1D5DB', background:'#F9FAFB', fontSize:11, cursor:'pointer', color: cfg[visKey as keyof Settings]?'#374151':'#9CA3AF' }}>
                  {cfg[visKey as keyof Settings]?'Visible':'Hidden'}
                </button>
              </div>
              <input style={IS} value={cfg[textKey as keyof Settings] as string} onChange={e=>set(textKey as keyof Settings, e.target.value as never)} />
            </div>
          ))}

        </div>

        {/* Right: live preview */}
        <div style={{ flex:1, overflowY:'auto', padding:24, background:'#E5E7EB', display:'flex', justifyContent:'center' }}>
          <div>
            <div style={{ fontSize:11, color:'#6B7280', fontWeight:600, textAlign:'center', marginBottom:8 }}>Live Preview - {Math.round(SCALE*100)}% scale · Drag elements in header</div>
            <div style={{ boxShadow:'0 4px 24px rgba(0,0,0,0.15)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ width:PW, background:'#fff', fontFamily:'Helvetica, Arial, sans-serif', fontSize:px(9), color:'#111827' }}>
                <HeaderCanvas cfg={cfg} selected={selected} onSelect={setSelected} onMove={moveElem} />
                <BodyPreview cfg={cfg} />
                <FooterPreview cfg={cfg} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
