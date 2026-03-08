// ════════════════════════════════════════════════════════════
//  PORTAL LAYER — Financial Modeler Pro Hub
//  Wraps all platforms. Currently hosts REFM.
//  Structure prepared for future platform additions.
// ════════════════════════════════════════════════════════════

// ── User subscription (future: backend-driven) ──────────────
const userSubscription = {
    userId:    'user_001',
    plan:      'Professional',
    platforms: ['refm'],
};

// ── Branding persistence ─────────────────────────────────────
const BRANDING_KEY = 'fmp_portal_branding_v1';

const DEFAULT_BRANDING = {
    portalTitle:       'Financial Modeler Pro',
    portalSubtitle:    'Platform Hub',
    portalDescription: 'A professional suite of financial modeling and planning tools — built for real estate developers, corporate finance teams, and FP&A professionals. Select a platform below to begin.',
    footerText:        'Professional Financial Modeling Suite',
    portalLogoType:    'emoji',   // 'emoji' | 'image'
    portalLogoEmoji:   '💼',
    portalLogoImage:   null,      // base64 data-URL or null
    platformName:      'REFM Platform',   // platform toolbar display name
    platformLogoType:  'emoji',   // 'emoji' | 'image'
    platformLogoEmoji: '🏗️',
    platformLogoImage: null,
    // Editable platform card registry (mirrors PLATFORM_REGISTRY defaults)
    platforms: null,  // null = use PLATFORM_REGISTRY defaults; array = custom overrides
    // White Label
    whiteLabel:        false,
    clientName:        '',
    clientLogo:        null,  // base64 data-URL or null
};

function loadBranding() {
    try {
        const raw = localStorage.getItem(BRANDING_KEY);
        if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) };
    } catch(e) {}
    return { ...DEFAULT_BRANDING };
}

function saveBranding(b) {
    try { localStorage.setItem(BRANDING_KEY, JSON.stringify(b)); } catch(e) {}
}

// ── Platform registry ────────────────────────────────────────
const PLATFORM_REGISTRY = [
    {
        id:          'refm',
        name:        'Real Estate Financial Modeling',
        shortName:   'REFM Platform',
        description: 'Advanced real estate development and investment modeling platform. Full project lifecycle, financing structures, and financial schedules.',
        icon:        '🏗️',
        accentColor: '#1E3A8A',
        iconBg:      '#EFF6FF',
        status:      'active',
        version:     'v40',
    },
    {
        id:          'dcf',
        name:        '3 Statement & DCF Modeling',
        shortName:   'DCF Platform',
        description: 'Corporate financial modeling and valuation tools. Three-statement model, DCF valuation, and comparable company analysis.',
        icon:        '📊',
        accentColor: '#166534',
        iconBg:      '#F0FDF4',
        status:      'coming_soon',
        version:     null,
    },
    {
        id:          'fpa',
        name:        'FP&A Planning',
        shortName:   'FP&A Platform',
        description: 'Budgeting, forecasting, and financial planning tools. Driver-based models, rolling forecasts, and variance analysis.',
        icon:        '📈',
        accentColor: '#6D28D9',
        iconBg:      '#F5F3FF',
        status:      'coming_soon',
        version:     null,
    },
    {
        id:          'cashflow',
        name:        'Cash Flow Forecasting',
        shortName:   'Cash Flow Platform',
        description: 'Treasury and liquidity forecasting platform. 13-week cash flow, working capital management, and scenario planning.',
        icon:        '💧',
        accentColor: '#0369A1',
        iconBg:      '#F0F9FF',
        status:      'coming_soon',
        version:     null,
    },
];

// ── Helper: check if user has access to a platform ──────────
const hasAccess = (platformId) => userSubscription.platforms.includes(platformId);

// ── Helper: get effective platform list (branding overrides or registry defaults) ──
function getEffectivePlatforms(branding) {
    if (!branding.platforms || !Array.isArray(branding.platforms) || branding.platforms.length === 0) {
        return PLATFORM_REGISTRY;
    }
    return PLATFORM_REGISTRY.map(reg => {
        const override = branding.platforms.find(p => p.id === reg.id);
        if (!override) return reg;
        return {
            ...reg,
            name:        override.name        !== undefined ? override.name        : reg.name,
            description: override.description !== undefined ? override.description : reg.description,
            status:      override.status      !== undefined ? override.status      : reg.status,
        };
    });
}

// ════════════════════════════════════════════════════════════
//  BRANDING SETTINGS PANEL — Admin-only, full branding control
//  Steps 3 & 4: consolidated portal + logo settings, RBAC guard
// ════════════════════════════════════════════════════════════
function BrandingSettingsPanel({ branding, onSave, onClose, isAdmin }) {

    // ── Guard: non-admin cannot use this panel ──
    if (!isAdmin) {
        return (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',
                         zIndex:99999,display:'flex',alignItems:'center',justifyContent:'center',
                         backdropFilter:'blur(5px)'}}>
                <div style={{background:'#0F2B46',borderRadius:'16px',padding:'40px 48px',
                             textAlign:'center',color:'white',maxWidth:'360px',
                             boxShadow:'0 28px 90px rgba(0,0,0,0.55)'}}>
                    <div style={{fontSize:'3rem',marginBottom:'16px'}}>🔒</div>
                    <div style={{fontWeight:800,fontSize:'16px',marginBottom:'8px'}}>Admin Only</div>
                    <div style={{fontSize:'13px',color:'rgba(255,255,255,0.55)',lineHeight:1.6,marginBottom:'24px'}}>
                        Branding settings can only be accessed by users with the Admin role.
                    </div>
                    <button onClick={onClose}
                        style={{padding:'9px 28px',background:'rgba(255,255,255,0.1)',color:'white',
                                border:'1px solid rgba(255,255,255,0.2)',borderRadius:'8px',
                                cursor:'pointer',fontSize:'13px',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
                        Close
                    </button>
                </div>
            </div>
        );
    }

    // ── State ──
    const initDraft = () => {
        const d = { ...branding };
        if (!d.platforms || !Array.isArray(d.platforms) || d.platforms.length === 0) {
            d.platforms = PLATFORM_REGISTRY.map(p => ({
                id: p.id, name: p.name, description: p.description, status: p.status,
            }));
        }
        if (!d.platformName) d.platformName = 'REFM Platform';
        return d;
    };
    const [draft, setDraft]           = React.useState(() => initDraft());
    const [saved, setSaved]           = React.useState(false);
    const [activeSection, setSection] = React.useState('portal');
    const [dragOver, setDragOver]     = React.useState(null); // 'portal' | 'platform' | null
    const portalLogoInputRef          = React.useRef(null);
    const platformLogoInputRef        = React.useRef(null);

    const upd = (key, val) => setDraft(d => ({ ...d, [key]: val }));

    // ── Logo upload handler (file input + drag-drop) ──
    const handleLogoUpload = (file, prefix) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            upd(prefix + 'LogoImage', e.target.result);
            upd(prefix + 'LogoType', 'image');
        };
        reader.readAsDataURL(file);
    };

    const handleSave = () => {
        onSave(draft);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
    };

    const handleReset = () => {
        if (window.confirm('Reset all branding to factory defaults? This cannot be undone.')) {
            setDraft({
                ...DEFAULT_BRANDING,
                platforms: PLATFORM_REGISTRY.map(p => ({
                    id: p.id, name: p.name, description: p.description, status: p.status,
                })),
            });
        }
    };

    // ── Shared styles ──
    const S = {
        label: { display:'block', fontSize:'11px', fontWeight:700, color:'#6B7280',
                 textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'6px' },
        input: { width:'100%', padding:'8px 12px', border:'1.5px solid #E5E7EB',
                 borderRadius:'8px', fontSize:'13px', fontFamily:'Inter,sans-serif',
                 background:'#FFFBEB', color:'#1E3A8A', boxSizing:'border-box',
                 outline:'none', transition:'border-color 0.15s, box-shadow 0.15s' },
        textarea: { width:'100%', padding:'8px 12px', border:'1.5px solid #E5E7EB',
                    borderRadius:'8px', fontSize:'13px', fontFamily:'Inter,sans-serif',
                    background:'#FFFBEB', color:'#1E3A8A', boxSizing:'border-box',
                    outline:'none', resize:'vertical', minHeight:'82px',
                    lineHeight:'1.6', transition:'border-color 0.15s' },
        field: { marginBottom:'20px' },
        sectionBtn: (active) => ({
            padding:'10px 16px', border:'none', background:'none', cursor:'pointer',
            fontSize:'12.5px', fontWeight: active ? 700 : 500,
            color: active ? '#1E3A8A' : '#6B7280',
            borderBottom: active ? '2.5px solid #1E3A8A' : '2.5px solid transparent',
            fontFamily:'Inter,sans-serif', transition:'all 0.15s', whiteSpace:'nowrap',
        }),
        divider: { height:'1px', background:'#F0F0F0', margin:'6px 0 22px' },
        sectionTitle: { fontSize:'12px', fontWeight:800, color:'#374151',
                        textTransform:'uppercase', letterSpacing:'0.08em',
                        marginBottom:'16px', display:'flex', alignItems:'center', gap:'7px' },
    };

    // ── Logo upload zone component (used for both portal + platform logos) ──
    const LogoUploadZone = ({ prefix, title }) => {
        const isImg  = draft[prefix + 'LogoType'] === 'image';
        const imgSrc = draft[prefix + 'LogoImage'];
        const emoji  = draft[prefix + 'LogoEmoji'] || (prefix === 'portal' ? '💼' : '🏗️');
        const ref    = prefix === 'portal' ? portalLogoInputRef : platformLogoInputRef;
        const isDrag = dragOver === prefix;

        return (
            <div style={{border:'1.5px solid #E5E7EB', borderRadius:'10px',
                         padding:'16px 18px', background:'#FAFAFA', marginBottom:'6px'}}>
                <div style={{display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap'}}>

                    {/* Preview box */}
                    <div style={{width:'56px', height:'56px', borderRadius:'10px',
                                 background: isImg ? '#F9FAFB' : '#EFF6FF',
                                 border: isImg ? '1px solid #E5E7EB' : '1px solid #BFDBFE',
                                 display:'flex', alignItems:'center', justifyContent:'center',
                                 fontSize:'28px', flexShrink:0, overflow:'hidden',
                                 boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
                        {isImg && imgSrc
                            ? <img src={imgSrc} alt="logo" style={{width:'100%',height:'100%',objectFit:'contain'}} />
                            : emoji}
                    </div>

                    {/* Controls */}
                    <div style={{flex:1, minWidth:'180px'}}>
                        <div style={{fontWeight:700, fontSize:'13px', color:'#111827', marginBottom:'10px'}}>{title}</div>

                        {/* Type toggle */}
                        <div style={{display:'flex', borderRadius:'7px', border:'1.5px solid #E5E7EB',
                                     overflow:'hidden', marginBottom:'10px', width:'fit-content'}}>
                            {['emoji','image'].map(t => (
                                <button key={t} onClick={() => upd(prefix+'LogoType', t)}
                                    style={{padding:'5px 14px', border:'none', cursor:'pointer',
                                            fontFamily:'Inter,sans-serif', fontSize:'12px', fontWeight:700,
                                            background: draft[prefix+'LogoType']===t ? '#1E3A8A' : '#F9FAFB',
                                            color: draft[prefix+'LogoType']===t ? 'white' : '#9CA3AF',
                                            transition:'all 0.15s'}}>
                                    {t === 'emoji' ? '😀 Emoji' : '🖼️ Upload Image'}
                                </button>
                            ))}
                        </div>

                        {/* Emoji input */}
                        {!isImg && (
                            <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                                <input style={{...S.input, maxWidth:'120px', background:'#FFFBEB'}}
                                    value={emoji}
                                    onChange={e => upd(prefix+'LogoEmoji', e.target.value)}
                                    placeholder="e.g. 💼" maxLength={4} />
                                <span style={{fontSize:'11px', color:'#9CA3AF'}}>Type or paste any emoji</span>
                            </div>
                        )}

                        {/* Image upload area */}
                        {isImg && (
                            <div>
                                {/* Hidden file input */}
                                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
                                    ref={ref} style={{display:'none'}}
                                    onChange={e => handleLogoUpload(e.target.files[0], prefix)} />

                                {/* Drop zone */}
                                <div
                                    onDragOver={e => { e.preventDefault(); setDragOver(prefix); }}
                                    onDragLeave={() => setDragOver(null)}
                                    onDrop={e => {
                                        e.preventDefault(); setDragOver(null);
                                        const file = e.dataTransfer.files[0];
                                        if (file) handleLogoUpload(file, prefix);
                                    }}
                                    onClick={() => ref.current && ref.current.click()}
                                    style={{
                                        border: isDrag ? '2px solid #1E3A8A' : '2px dashed #D1D5DB',
                                        borderRadius:'8px', padding:'14px 16px',
                                        background: isDrag ? '#EFF6FF' : '#F9FAFB',
                                        cursor:'pointer', textAlign:'center',
                                        transition:'all 0.15s', marginBottom: imgSrc ? '8px' : '0',
                                    }}>
                                    <div style={{fontSize:'20px', marginBottom:'4px'}}>
                                        {isDrag ? '📂' : '⬆️'}
                                    </div>
                                    <div style={{fontSize:'12px', fontWeight:600, color: isDrag ? '#1E3A8A' : '#374151', marginBottom:'2px'}}>
                                        {isDrag ? 'Drop to upload' : (imgSrc ? 'Click or drag to replace' : 'Click or drag image here')}
                                    </div>
                                    <div style={{fontSize:'11px', color:'#9CA3AF'}}>
                                        PNG, JPG, SVG, GIF, WebP · max 2 MB · recommended 64×64px
                                    </div>
                                </div>

                                {/* Remove button */}
                                {imgSrc && (
                                    <button onClick={() => { upd(prefix+'LogoImage', null); upd(prefix+'LogoType','emoji'); }}
                                        style={{padding:'5px 12px', border:'1px solid #FECACA',
                                                borderRadius:'6px', background:'#FEF2F2', color:'#991B1B',
                                                cursor:'pointer', fontSize:'11px', fontWeight:600,
                                                fontFamily:'Inter,sans-serif', transition:'all 0.15s'}}>
                                        ✕ Remove Image
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.65)',
                     zIndex:99999, display:'flex', alignItems:'center',
                     justifyContent:'center', backdropFilter:'blur(5px)'}}
             onClick={onClose}>
            <div style={{background:'#fff', borderRadius:'16px',
                         boxShadow:'0 28px 90px rgba(0,0,0,0.38)',
                         width:'700px', maxWidth:'97vw', maxHeight:'92vh',
                         overflow:'hidden', display:'flex', flexDirection:'column'}}
                 onClick={e => e.stopPropagation()}>

                {/* ── Header ── */}
                <div style={{background:'var(--color-primary-deep)', padding:'18px 24px',
                             display:'flex', alignItems:'center', justifyContent:'space-between',
                             flexShrink:0}}>
                    <div>
                        <div style={{fontWeight:800, color:'white', fontSize:'15px', letterSpacing:'-0.01em',
                                     display:'flex', alignItems:'center', gap:'8px'}}>
                            🎨 Branding Settings
                            <span style={{fontSize:'10px', fontWeight:700, padding:'2px 8px',
                                          borderRadius:'999px', background:'rgba(239,68,68,0.25)',
                                          color:'#fca5a5', border:'1px solid rgba(239,68,68,0.35)',
                                          letterSpacing:'0.06em', textTransform:'uppercase'}}>
                                Admin Only
                            </span>
                        </div>
                        <div style={{fontSize:'11px', color:'rgba(255,255,255,0.42)', marginTop:'3px'}}>
                            Changes are saved to your browser and persist across sessions
                        </div>
                    </div>
                    <button onClick={onClose}
                        style={{background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'8px',
                                width:'32px', height:'32px', display:'flex', alignItems:'center',
                                justifyContent:'center', cursor:'pointer', color:'rgba(255,255,255,0.75)',
                                fontSize:'16px', transition:'background 0.15s'}}>
                        ✕
                    </button>
                </div>

                {/* ── Section Tabs ── */}
                <div style={{display:'flex', borderBottom:'1px solid #E5E7EB',
                             background:'#F9FAFB', paddingLeft:'8px', flexShrink:0,
                             overflowX:'auto'}}>
                    {[
                        { id:'portal',     label:'🏠 Portal Branding' },
                        { id:'platform',   label:'⚙️ Platform Toolbar' },
                        { id:'platforms',  label:'🗂️ Platform Cards' },
                        { id:'whitelabel', label:'🏷️ White Label' },
                    ].map(s => (
                        <button key={s.id} onClick={() => setSection(s.id)}
                                style={S.sectionBtn(activeSection === s.id)}>
                            {s.label}
                        </button>
                    ))}
                </div>

                {/* ── Body ── */}
                <div style={{flex:1, overflowY:'auto', padding:'24px 26px'}}>

                    {/* ══════════════════════════════════════════
                        TAB 1: PORTAL BRANDING
                        All portal-level text fields + both logos
                    ══════════════════════════════════════════ */}
                    {activeSection === 'portal' && (<>
                        <div style={{background:'#EFF6FF', border:'1px solid #BFDBFE',
                                     borderRadius:'8px', padding:'10px 14px',
                                     fontSize:'12px', color:'#1E40AF', lineHeight:1.55,
                                     marginBottom:'22px'}}>
                            Edit all portal-facing content — header text, welcome banner, footer, and logos. All changes persist in your browser after saving.
                        </div>

                        {/* ── SECTION: Text Fields ── */}
                        <div style={S.sectionTitle}>
                            <span style={{background:'#EFF6FF',color:'#1E3A8A',padding:'3px 8px',
                                          borderRadius:'5px',fontSize:'10px'}}>TEXT</span>
                            Portal Content
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Portal Title <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(shown in header bar)</span></label>
                            <input style={S.input} value={draft.portalTitle}
                                onChange={e => upd('portalTitle', e.target.value)}
                                placeholder="e.g. Financial Modeler Pro" />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Portal Subtitle <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(shown below title)</span></label>
                            <input style={S.input} value={draft.portalSubtitle}
                                onChange={e => upd('portalSubtitle', e.target.value)}
                                placeholder="e.g. Platform Hub" />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Portal Description <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(welcome banner body text)</span></label>
                            <textarea style={S.textarea} value={draft.portalDescription}
                                onChange={e => upd('portalDescription', e.target.value)}
                                placeholder="Describe your platform suite…" />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Footer Text <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(shown in portal footer bar)</span></label>
                            <input style={S.input} value={draft.footerText}
                                onChange={e => upd('footerText', e.target.value)}
                                placeholder="e.g. Professional Financial Modeling Suite" />
                        </div>

                        <div style={S.divider} />

                        {/* ── SECTION: Logos ── */}
                        <div style={S.sectionTitle}>
                            <span style={{background:'#F0FDF4',color:'#166534',padding:'3px 8px',
                                          borderRadius:'5px',fontSize:'10px'}}>LOGOS</span>
                            Logo Upload
                        </div>

                        <div style={{fontSize:'12px', color:'#6B7280', lineHeight:1.55, marginBottom:'16px'}}>
                            Upload PNG, JPG, SVG or WebP images, or use an emoji. Uploaded images are stored in your browser and replace the default logos immediately.
                        </div>

                        <LogoUploadZone prefix="portal"   title="Portal Logo (header bar)" />
                        <div style={{height:'10px'}} />
                        <LogoUploadZone prefix="platform" title="Platform Logo (inside REFM toolbar)" />

                        <div style={S.divider} />

                        {/* ── SECTION: Live Preview ── */}
                        <div style={S.sectionTitle}>
                            <span style={{background:'#FFF7ED',color:'#92400E',padding:'3px 8px',
                                          borderRadius:'5px',fontSize:'10px'}}>PREVIEW</span>
                            Live Preview
                        </div>

                        {/* Header preview */}
                        <div style={{background:'var(--color-primary-deep)', borderRadius:'8px',
                                     padding:'11px 16px', display:'flex', alignItems:'center',
                                     gap:'10px', marginBottom:'8px'}}>
                            <div style={{width:'32px', height:'32px', background:'var(--color-primary)',
                                         borderRadius:'8px', display:'flex', alignItems:'center',
                                         justifyContent:'center', flexShrink:0,
                                         overflow:'hidden', border:'1px solid rgba(255,255,255,0.15)'}}>
                                {draft.portalLogoType === 'image' && draft.portalLogoImage
                                    ? <img src={draft.portalLogoImage} style={{width:'100%',height:'100%',objectFit:'contain'}} />
                                    : <span style={{fontSize:'16px'}}>{draft.portalLogoEmoji || '💼'}</span>}
                            </div>
                            <div>
                                <div style={{fontWeight:700, color:'white', fontSize:'13px'}}>
                                    {draft.portalTitle || '—'}
                                </div>
                                <div style={{fontSize:'9.5px', color:'rgba(255,255,255,0.38)',
                                             textTransform:'uppercase', letterSpacing:'0.06em'}}>
                                    {draft.portalSubtitle || '—'}
                                </div>
                            </div>
                        </div>

                        {/* Welcome banner preview */}
                        <div style={{background:'white', border:'1px solid #E5E7EB',
                                     borderRadius:'8px', padding:'14px 16px',
                                     borderLeft:'4px solid var(--color-primary)',
                                     marginBottom:'8px'}}>
                            <div style={{fontWeight:700, color:'var(--color-heading)',
                                         fontSize:'14px', marginBottom:'5px'}}>
                                Welcome to {draft.portalTitle || '—'}
                            </div>
                            <div style={{fontSize:'12px', color:'#6B7280', lineHeight:1.6}}>
                                {draft.portalDescription || '—'}
                            </div>
                        </div>

                        {/* Footer preview */}
                        <div style={{background:'#F9FAFB', border:'1px solid #E5E7EB',
                                     borderRadius:'8px', padding:'10px 16px',
                                     textAlign:'center', fontSize:'11px', color:'#9CA3AF'}}>
                            {draft.whiteLabel
                                ? <span>© {draft.clientName || 'Client Company Name'}</span>
                                : <>
                                    <strong style={{color:'#374151'}}>{draft.portalTitle || '—'}</strong>
                                    {' · '}{draft.footerText || '—'}
                                    {' · '}<span style={{color:'var(--color-success)',fontWeight:600}}>{userSubscription.platforms.length} Platform Active</span>
                                  </>
                            }
                        </div>
                    </>)}

                    {/* ══════════════════════════════════════════
                        TAB 2: PLATFORM TOOLBAR
                        Name + icon displayed inside REFM platform
                    ══════════════════════════════════════════ */}
                    {activeSection === 'platform' && (<>
                        <div style={{background:'#EFF6FF', border:'1px solid #BFDBFE',
                                     borderRadius:'8px', padding:'10px 14px',
                                     fontSize:'12px', color:'#1E40AF', lineHeight:1.55,
                                     marginBottom:'22px'}}>
                            This controls the name and icon displayed in the toolbar <strong>inside the REFM platform</strong>. This is separate from the portal header branding above.
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Platform Name <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(shown in the platform toolbar)</span></label>
                            <input style={S.input} value={draft.platformName || ''}
                                onChange={e => upd('platformName', e.target.value)}
                                placeholder="e.g. REFM Platform" />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Platform Icon <span style={{fontWeight:400,color:'#9CA3AF',textTransform:'none',letterSpacing:0}}>(emoji shown next to platform name)</span></label>
                            <div style={{display:'flex', gap:'7px', flexWrap:'wrap', marginBottom:'10px'}}>
                                {['🏗️','🏢','🌆','🏙️','📐','💼','🔷','⬡','🏛️','📊'].map(icon => (
                                    <button key={icon} onClick={() => upd('platformLogoEmoji', icon)}
                                        style={{
                                            fontSize:'20px', padding:'7px', borderRadius:'8px',
                                            cursor:'pointer', border:'none', transition:'all 0.15s',
                                            background: draft.platformLogoEmoji===icon ? '#EFF6FF' : '#F9FAFB',
                                            boxShadow: draft.platformLogoEmoji===icon
                                                ? '0 0 0 2px #1E3A8A' : '0 0 0 1px #E5E7EB',
                                        }}>
                                        {icon}
                                    </button>
                                ))}
                            </div>
                            <input style={{...S.input, maxWidth:'140px'}}
                                value={draft.platformLogoEmoji || ''}
                                onChange={e => upd('platformLogoEmoji', e.target.value)}
                                placeholder="Or type any emoji…" maxLength={4} />
                        </div>

                        <div style={S.divider} />

                        {/* Toolbar live preview */}
                        <div style={S.sectionTitle}>
                            <span style={{background:'#FFF7ED',color:'#92400E',padding:'3px 8px',
                                          borderRadius:'5px',fontSize:'10px'}}>PREVIEW</span>
                            Toolbar Preview
                        </div>
                        <div style={{background:'var(--color-primary-deep)', borderRadius:'8px',
                                     padding:'0 16px', height:'42px', display:'flex',
                                     alignItems:'center', gap:'10px',
                                     boxShadow:'0 2px 8px rgba(0,0,0,0.2)'}}>
                            <div style={{width:'26px', height:'26px', background:'rgba(255,255,255,0.12)',
                                         borderRadius:'6px', display:'flex', alignItems:'center',
                                         justifyContent:'center', fontSize:'14px', flexShrink:0,
                                         overflow:'hidden', border:'1px solid rgba(255,255,255,0.1)'}}>
                                {draft.platformLogoType === 'image' && draft.platformLogoImage
                                    ? <img src={draft.platformLogoImage} style={{width:'100%',height:'100%',objectFit:'contain'}} />
                                    : <span>{draft.platformLogoEmoji || '🏗️'}</span>}
                            </div>
                            <span style={{color:'white', fontWeight:700, fontSize:'11px',
                                          letterSpacing:'0.06em', textTransform:'uppercase'}}>
                                {draft.platformName || 'REFM Platform'}
                            </span>
                            <div style={{flex:1}} />
                            <div style={{background:'rgba(255,255,255,0.08)', borderRadius:'4px',
                                         padding:'3px 8px', fontSize:'10px', color:'rgba(255,255,255,0.45)'}}>
                                v40
                            </div>
                        </div>
                    </>)}

                    {/* ══════════════════════════════════════════
                        TAB 3: PLATFORM CARDS EDITOR
                        Edit each card on the portal grid
                    ══════════════════════════════════════════ */}
                    {activeSection === 'platforms' && (() => {
                        const draftPlatforms = (draft.platforms && draft.platforms.length)
                            ? draft.platforms
                            : PLATFORM_REGISTRY.map(p => ({ id: p.id, name: p.name, description: p.description, status: p.status }));

                        const updPlatform = (id, field, value) => {
                            const updated = draftPlatforms.map(p =>
                                p.id === id ? { ...p, [field]: value } : p
                            );
                            upd('platforms', updated);
                        };

                        return (
                            <>
                                <div style={{background:'#EFF6FF', border:'1px solid #BFDBFE',
                                             borderRadius:'8px', padding:'10px 14px',
                                             fontSize:'12px', color:'#1E40AF', lineHeight:1.55,
                                             marginBottom:'22px'}}>
                                    Edit the name, description, and status of each platform card shown on the portal. Changes apply after saving.
                                </div>

                                {PLATFORM_REGISTRY.map((reg, idx) => {
                                    const p = draftPlatforms.find(x => x.id === reg.id) || reg;
                                    return (
                                        <div key={reg.id} style={{
                                            border:'1.5px solid #E5E7EB', borderRadius:'10px',
                                            padding:'16px 18px', marginBottom:'14px',
                                            background:'#FAFAFA',
                                        }}>
                                            {/* Card Header */}
                                            <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px'}}>
                                                <div style={{width:'36px', height:'36px', borderRadius:'8px',
                                                             background: reg.iconBg, display:'flex', alignItems:'center',
                                                             justifyContent:'center', fontSize:'18px', flexShrink:0,
                                                             border:'1px solid #E5E7EB'}}>
                                                    {reg.icon}
                                                </div>
                                                <div style={{flex:1}}>
                                                    <div style={{fontSize:'11px', fontWeight:700, color:'#9CA3AF',
                                                                 textTransform:'uppercase', letterSpacing:'0.06em'}}>
                                                        Platform {idx + 1} · ID: {reg.id}
                                                    </div>
                                                </div>
                                                {/* Status toggle */}
                                                <div style={{display:'flex', borderRadius:'6px', border:'1.5px solid #E5E7EB', overflow:'hidden', flexShrink:0}}>
                                                    {['active','coming_soon'].map(s => (
                                                        <button key={s}
                                                            onClick={() => updPlatform(reg.id, 'status', s)}
                                                            style={{
                                                                padding:'5px 11px', border:'none', cursor:'pointer',
                                                                fontFamily:'Inter,sans-serif', fontSize:'11px', fontWeight:700,
                                                                background: p.status === s ? (s === 'active' ? '#166534' : '#92400E') : '#F9FAFB',
                                                                color: p.status === s ? 'white' : '#9CA3AF',
                                                                transition:'all 0.15s',
                                                            }}>
                                                            {s === 'active' ? '✅ Active' : '🚧 Coming Soon'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div style={{marginBottom:'12px'}}>
                                                <label style={S.label}>Platform Name</label>
                                                <input style={S.input} value={p.name}
                                                    onChange={e => updPlatform(reg.id, 'name', e.target.value)}
                                                    placeholder={reg.name} />
                                            </div>

                                            <div>
                                                <label style={S.label}>Platform Description</label>
                                                <textarea style={S.textarea} value={p.description}
                                                    onChange={e => updPlatform(reg.id, 'description', e.target.value)}
                                                    placeholder={reg.description} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        );
                    })()}

                </div>

                {/* ══════════════════════════════════════════
                        TAB 4: WHITE LABEL
                        Hide FMP branding, show client branding
                    ══════════════════════════════════════════ */}
                    {activeSection === 'whitelabel' && (() => {
                        const clientLogoInputRef = React.useRef(null);

                        const handleClientLogoUpload = (file) => {
                            if (!file || !file.type.startsWith('image/')) return;
                            const reader = new FileReader();
                            reader.onload = (e) => upd('clientLogo', e.target.result);
                            reader.readAsDataURL(file);
                        };

                        return (
                            <>
                                <div style={{background:'#F5F3FF', border:'1px solid #DDD6FE',
                                             borderRadius:'8px', padding:'10px 14px',
                                             fontSize:'12px', color:'#5B21B6', lineHeight:1.55,
                                             marginBottom:'22px'}}>
                                    White label mode hides all <strong>Financial Modeler Pro</strong> and <strong>PaceMakers</strong> references and replaces them with your client's brand.
                                </div>

                                {/* Toggle */}
                                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                                             border:'1.5px solid #E5E7EB', borderRadius:'10px',
                                             padding:'14px 18px', background:'#FAFAFA',
                                             marginBottom:'20px'}}>
                                    <div>
                                        <div style={{fontWeight:700, fontSize:'13px', color:'#111827', marginBottom:'4px'}}>
                                            Enable White Label Mode
                                        </div>
                                        <div style={{fontSize:'12px', color:'#6B7280', lineHeight:1.5}}>
                                            Replace FMP branding with client company name and logo
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => upd('whiteLabel', !draft.whiteLabel)}
                                        style={{
                                            width:'52px', height:'28px', borderRadius:'999px',
                                            border:'none', cursor:'pointer', transition:'background 0.2s',
                                            background: draft.whiteLabel ? '#166534' : '#D1D5DB',
                                            position:'relative', flexShrink:0,
                                        }}>
                                        <span style={{
                                            position:'absolute', top:'3px',
                                            left: draft.whiteLabel ? '27px' : '3px',
                                            width:'22px', height:'22px', borderRadius:'50%',
                                            background:'white', transition:'left 0.2s',
                                            boxShadow:'0 1px 4px rgba(0,0,0,0.18)',
                                        }} />
                                    </button>
                                </div>

                                {/* Client fields — only shown when white label is on */}
                                <div style={{opacity: draft.whiteLabel ? 1 : 0.4, pointerEvents: draft.whiteLabel ? 'auto' : 'none',
                                             transition:'opacity 0.2s'}}>

                                    <div style={S.field}>
                                        <label style={S.label}>Client Company Name</label>
                                        <input style={S.input} value={draft.clientName || ''}
                                            onChange={e => upd('clientName', e.target.value)}
                                            placeholder="e.g. Acme Real Estate Partners" />
                                        <div style={{fontSize:'11px', color:'#9CA3AF', marginTop:'5px'}}>
                                            Replaces "Financial Modeler Pro" in headers and footers.
                                        </div>
                                    </div>

                                    <div style={S.field}>
                                        <label style={S.label}>Client Logo</label>
                                        <div style={{display:'flex', gap:'14px', alignItems:'flex-start',
                                                     border:'1.5px solid #E5E7EB', borderRadius:'10px',
                                                     padding:'14px 16px', background:'#FAFAFA'}}>
                                            {/* Preview */}
                                            <div style={{width:'56px', height:'56px', borderRadius:'10px',
                                                         background:'#F3F4F6', border:'1px solid #E5E7EB',
                                                         display:'flex', alignItems:'center', justifyContent:'center',
                                                         flexShrink:0, overflow:'hidden', fontSize:'24px'}}>
                                                {draft.clientLogo
                                                    ? <img src={draft.clientLogo} style={{width:'100%',height:'100%',objectFit:'contain'}} />
                                                    : '🏢'}
                                            </div>
                                            <div style={{flex:1}}>
                                                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
                                                    ref={clientLogoInputRef} style={{display:'none'}}
                                                    onChange={e => handleClientLogoUpload(e.target.files[0])} />
                                                <div
                                                    onClick={() => clientLogoInputRef.current && clientLogoInputRef.current.click()}
                                                    style={{border:'2px dashed #D1D5DB', borderRadius:'8px',
                                                            padding:'14px 16px', background:'#F9FAFB',
                                                            cursor:'pointer', textAlign:'center', marginBottom:'8px'}}>
                                                    <div style={{fontSize:'18px', marginBottom:'3px'}}>⬆️</div>
                                                    <div style={{fontSize:'12px', fontWeight:600, color:'#374151'}}>
                                                        {draft.clientLogo ? 'Click to replace logo' : 'Click to upload logo'}
                                                    </div>
                                                    <div style={{fontSize:'11px', color:'#9CA3AF'}}>PNG, JPG, SVG, WebP · max 2 MB</div>
                                                </div>
                                                {draft.clientLogo && (
                                                    <button onClick={() => upd('clientLogo', null)}
                                                        style={{padding:'5px 12px', border:'1px solid #FECACA',
                                                                borderRadius:'6px', background:'#FEF2F2', color:'#991B1B',
                                                                cursor:'pointer', fontSize:'11px', fontWeight:600,
                                                                fontFamily:'Inter,sans-serif'}}>
                                                        ✕ Remove Logo
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Preview */}
                                    <div style={{...S.sectionTitle, marginTop:'4px'}}>
                                        <span style={{background:'#FFF7ED',color:'#92400E',padding:'3px 8px',
                                                      borderRadius:'5px',fontSize:'10px'}}>PREVIEW</span>
                                        Footer Preview
                                    </div>
                                    <div style={{background:'#F9FAFB', border:'1px solid #E5E7EB',
                                                 borderRadius:'8px', padding:'10px 16px',
                                                 textAlign:'center', fontSize:'11px', color:'#9CA3AF'}}>
                                        {draft.whiteLabel
                                            ? <span>© {draft.clientName || 'Client Company Name'}</span>
                                            : <span><strong style={{color:'#374151'}}>{draft.portalTitle || 'Financial Modeler Pro'}</strong>
                                                {' · '}{draft.footerText || '—'}</span>
                                        }
                                    </div>
                                </div>
                            </>
                        );
                    })()}


                <div style={{padding:'14px 24px', borderTop:'1px solid #E5E7EB',
                             display:'flex', alignItems:'center', justifyContent:'space-between',
                             background:'#F9FAFB', flexShrink:0}}>
                    <button onClick={handleReset}
                        style={{padding:'8px 14px', border:'1px solid #E5E7EB',
                                borderRadius:'7px', background:'white', cursor:'pointer',
                                fontSize:'12px', color:'#9CA3AF', fontFamily:'Inter,sans-serif',
                                fontWeight:600, transition:'all 0.15s'}}>
                        ↩ Reset to Defaults
                    </button>
                    <div style={{display:'flex', gap:'8px'}}>
                        <button onClick={onClose}
                            style={{padding:'8px 18px', border:'1.5px solid #D1D5DB',
                                    borderRadius:'7px', background:'white', cursor:'pointer',
                                    fontSize:'13px', color:'#374151',
                                    fontFamily:'Inter,sans-serif', fontWeight:600}}>
                            Cancel
                        </button>
                        <button onClick={handleSave}
                            style={{padding:'8px 22px',
                                    background: saved ? '#166534' : 'var(--color-primary)',
                                    color:'white', border:'none', borderRadius:'7px',
                                    cursor:'pointer', fontSize:'13px', fontWeight:700,
                                    fontFamily:'Inter,sans-serif', transition:'background 0.2s',
                                    display:'flex', alignItems:'center', gap:'6px'}}>
                            {saved ? '✓ Saved!' : '💾 Save Branding'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}

