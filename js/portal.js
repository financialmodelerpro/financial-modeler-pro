// ════════════════════════════════════════════════════════════
//  PORTAL APP COMPONENT
// ════════════════════════════════════════════════════════════
function PortalApp({ onLaunch, branding, onOpenBrandingSettings, isAdmin }) {
    const [upgradeTarget, setUpgradeTarget] = React.useState(null);

    const handleLaunch = (platformId) => {
        if (!hasAccess(platformId)) { setUpgradeTarget(platformId); return; }
        onLaunch(platformId);
    };

    // Resolve portal logo for display
    const PortalLogoEl = () => {
        if (branding.whiteLabel && branding.clientLogo) {
            return (
                <div className="portal-header-logo-icon" style={{padding:0, overflow:'hidden'}}>
                    <img src={branding.clientLogo}
                         style={{width:'100%', height:'100%', objectFit:'contain'}} />
                </div>
            );
        }
        if (branding.portalLogoType === 'image' && branding.portalLogoImage) {
            return (
                <div className="portal-header-logo-icon" style={{padding:0, overflow:'hidden'}}>
                    <img src={branding.portalLogoImage}
                         style={{width:'100%', height:'100%', objectFit:'contain'}} />
                </div>
            );
        }
        return <div className="portal-header-logo-icon">{branding.portalLogoEmoji || '💼'}</div>;
    };

    return (
        <div className="portal-root">
            {/* ── Portal Header ── */}
            <header className="portal-header">
                <div className="portal-header-logo">
                    <PortalLogoEl />
                    <div>
                        <div className="portal-header-title">
                            {branding.whiteLabel ? (branding.clientName || 'Client Company') : branding.portalTitle}
                        </div>
                        <div className="portal-header-subtitle">
                            {branding.whiteLabel ? '' : branding.portalSubtitle}
                        </div>
                    </div>
                </div>
                <div className="portal-header-spacer" />
                {isAdmin && (
                    <button onClick={onOpenBrandingSettings}
                        style={{marginRight:'10px', display:'inline-flex', alignItems:'center',
                                gap:'5px', height:'28px', padding:'0 12px',
                                borderRadius:'var(--radius-sm)', fontSize:'11px',
                                fontWeight:700, cursor:'pointer', letterSpacing:'0.03em',
                                border:'1px solid rgba(255,255,255,0.22)',
                                background:'rgba(255,255,255,0.09)',
                                color:'rgba(255,255,255,0.85)',
                                transition:'var(--transition)', fontFamily:'Inter,sans-serif'}}>
                        🎨 Branding Settings
                    </button>
                )}
                <span className="portal-header-version-pill">{userSubscription.plan} Plan</span>
            </header>

            {/* ── Portal Body ── */}
            <main className="portal-body">

                {/* Welcome Banner */}
                <div className="portal-welcome">
                    <div>
                        <h1>Welcome to {branding.whiteLabel ? (branding.clientName || 'Client Company') : branding.portalTitle}</h1>
                        <p>{branding.portalDescription}</p>
                    </div>
                </div>

                {/* Platform Cards */}
                <div className="portal-section-label">Available Platforms</div>
                <div className="portal-grid">
                    {getEffectivePlatforms(branding).map(platform => {
                        const accessible   = hasAccess(platform.id);
                        const isActive     = platform.status === 'active';
                        const isLocked     = isActive && !accessible;
                        const isComingSoon = platform.status === 'coming_soon';

                        // Determine the icon to render for REFM platform
                        const showCustomPlatformLogo = platform.id === 'refm'
                            && branding.platformLogoType === 'image'
                            && branding.platformLogoImage;

                        return (
                            <div key={platform.id}
                                 className={`portal-platform-card${isLocked ? ' locked' : ''}`}>
                                <div className="portal-card-accent" style={{background: platform.accentColor}} />
                                <div className="portal-card-body">
                                    <div className="portal-card-icon-row">
                                        <div className="portal-card-icon"
                                             style={{background: platform.iconBg, overflow:'hidden', padding:0}}>
                                            {showCustomPlatformLogo
                                                ? <img src={branding.platformLogoImage}
                                                       style={{width:'100%',height:'100%',objectFit:'contain'}} />
                                                : (platform.id === 'refm' && branding.platformLogoType === 'emoji')
                                                    ? <span style={{fontSize:'20px'}}>{branding.platformLogoEmoji || platform.icon}</span>
                                                    : <span style={{fontSize:'20px'}}>{platform.icon}</span>
                                            }
                                        </div>
                                        <span className={`portal-card-status-pill ${isActive ? 'active' : 'soon'}`}>
                                            {isActive ? 'Active' : 'Coming Soon'}
                                        </span>
                                    </div>
                                    <p className="portal-card-name">{platform.name}</p>
                                    <p className="portal-card-desc">{platform.description}</p>
                                </div>
                                <div className="portal-card-footer">
                                    {isComingSoon ? (
                                        <button className="portal-launch-btn coming-soon" disabled>🚧 Coming Soon</button>
                                    ) : isLocked ? (
                                        <button className="portal-launch-btn upgrade"
                                            onClick={() => setUpgradeTarget(platform.id)}
                                            title="Your current plan does not include this platform">
                                            🔒 Upgrade to Access
                                        </button>
                                    ) : (
                                        <button className="portal-launch-btn available"
                                            onClick={() => handleLaunch(platform.id)}>
                                            🚀 Launch Platform
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="portal-footer">
                    {branding.whiteLabel ? (
                        <span>
                            {branding.clientLogo && (
                                <img src={branding.clientLogo}
                                     style={{height:'16px', verticalAlign:'middle',
                                             objectFit:'contain', marginRight:'6px'}} />
                            )}
                            © {branding.clientName || 'Client Company'}
                        </span>
                    ) : (
                        <>
                            <strong>{branding.portalTitle}</strong> · {branding.footerText} ·{' '}
                            <span>{userSubscription.plan} Plan</span> ·{' '}
                            <span style={{color:'var(--color-success)',fontWeight:'var(--fw-semibold)'}}>
                                {userSubscription.platforms.length} Platform{userSubscription.platforms.length !== 1 ? 's' : ''} Active
                            </span>
                        </>
                    )}
                </div>
            </main>

            {/* ── Upgrade Modal ── */}
            {upgradeTarget && (() => {
                const p = PLATFORM_REGISTRY.find(x => x.id === upgradeTarget);
                if (!p) return null;
                return (
                    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}}
                        onClick={() => setUpgradeTarget(null)}>
                        <div style={{background:'var(--color-surface)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-modal)',width:'420px',maxWidth:'95vw',overflow:'hidden'}}
                            onClick={e => e.stopPropagation()}>
                            <div style={{background:'var(--color-primary-deep)',padding:'var(--sp-3) var(--sp-4)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                <div>
                                    <div style={{fontWeight:'var(--fw-bold)',color:'white',fontSize:'var(--font-section)'}}>{p.icon} {p.shortName}</div>
                                    <div style={{fontSize:'var(--font-meta)',color:'rgba(255,255,255,0.5)',marginTop:'2px'}}>Platform access required</div>
                                </div>
                                <button onClick={() => setUpgradeTarget(null)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'1.2rem',lineHeight:1}}>✕</button>
                            </div>
                            <div style={{padding:'var(--sp-4)'}}>
                                <p style={{fontSize:'var(--font-body)',color:'var(--color-body)',lineHeight:1.6,margin:'0 0 var(--sp-3)'}}>
                                    <strong>{p.name}</strong> is not included in your current <strong>{userSubscription.plan}</strong> plan.
                                    Upgrade your subscription to unlock access to this platform.
                                </p>
                                <div style={{background:'var(--color-row-alt)',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)',padding:'var(--sp-2)',marginBottom:'var(--sp-3)'}}>
                                    <div style={{fontSize:'var(--font-micro)',color:'var(--color-meta)',marginBottom:'4px',fontWeight:'var(--fw-semibold)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Current Plan</div>
                                    <div style={{fontWeight:'var(--fw-bold)',color:'var(--color-heading)',fontSize:'var(--font-body)'}}>{userSubscription.plan} · {userSubscription.platforms.length} Platform{userSubscription.platforms.length !== 1 ? 's' : ''}</div>
                                </div>
                                <div style={{display:'flex',gap:'var(--sp-1)',justifyContent:'flex-end'}}>
                                    <button onClick={() => setUpgradeTarget(null)}
                                        style={{padding:'var(--sp-1) var(--sp-2)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-sm)',background:'var(--color-surface)',cursor:'pointer',fontSize:'var(--font-body)',color:'var(--color-body)',fontWeight:'var(--fw-medium)'}}>
                                        Cancel
                                    </button>
                                    <button onClick={() => { setUpgradeTarget(null); alert('Contact your administrator or visit the billing portal to upgrade your subscription.'); }}
                                        style={{padding:'var(--sp-1) var(--sp-2)',background:'var(--color-primary)',color:'white',border:'none',borderRadius:'var(--radius-sm)',cursor:'pointer',fontSize:'var(--font-body)',fontWeight:'var(--fw-semibold)'}}>
                                        Contact Sales →
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

// ════════════════════════════════════════════════════════════
//  APP ROOT — manages portal ↔ platform routing
//  Holds branding state at the root level (persisted).
//  refm-platform.js is lazy-loaded on demand so the portal
//  renders instantly without waiting for the full engine.
// ════════════════════════════════════════════════════════════
function AppRoot() {
    const [activePlatform, setActivePlatform]       = React.useState(null);
    const [branding, setBranding]                   = React.useState(() => loadBranding());
    const [brandingPanelOpen, setBrandingPanelOpen] = React.useState(false);
    const [currentUserRole, setCurrentUserRole]     = React.useState(ROLES.ADMIN);
    const [refmReady, setRefmReady]                 = React.useState(false);
    const [refmLoading, setRefmLoading]             = React.useState(false);
    const isAdmin = currentUserRole === ROLES.ADMIN;

    const loadRefm = () => {
        if (typeof RealEstatePlatform !== 'undefined') { setRefmReady(true); return; }
        if (refmLoading) return;
        setRefmLoading(true);
        // refm-platform.js is already being compiled by Babel (loaded as script tag).
        // Poll until it finishes — works on file:// with no server required.
        const iv = setInterval(() => {
            if (typeof RealEstatePlatform !== 'undefined') {
                clearInterval(iv);
                setRefmReady(true);
                setRefmLoading(false);
            }
        }, 200);
        // Safety timeout — stop spinner after 90s if something went wrong
        setTimeout(() => clearInterval(iv), 90000);
    };

    const launchPlatform = (platformId) => {
        setActivePlatform(platformId);
        document.body.classList.add('refm-active');
        if (platformId === 'refm') loadRefm();
    };

    const backToPortal = (role) => {
        setActivePlatform(null);
        document.body.classList.remove('refm-active');
        if (role) setCurrentUserRole(role);
    };

    const handleBrandingSave = (newBranding) => {
        setBranding(newBranding);
        saveBranding(newBranding);
    };

    // Portal view
    if (activePlatform === null) {
        return (
            <>
                <PortalApp
                    onLaunch={launchPlatform}
                    branding={branding}
                    isAdmin={isAdmin}
                    onOpenBrandingSettings={() => setBrandingPanelOpen(true)}
                />
                {brandingPanelOpen && (
                    <BrandingSettingsPanel
                        branding={branding}
                        onSave={handleBrandingSave}
                        onClose={() => setBrandingPanelOpen(false)}
                        isAdmin={isAdmin}
                    />
                )}
            </>
        );
    }

    // REFM platform — compiling
    if (activePlatform === 'refm' && !refmReady) {
        return (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',
                         height:'100vh',flexDirection:'column',gap:'16px',
                         background:'#0F2B46',fontFamily:'Inter,sans-serif'}}>
                <div style={{fontSize:'3rem'}}>🏗️</div>
                <div style={{fontWeight:700,color:'white',fontSize:'16px'}}>Loading REFM Platform…</div>
                <div style={{fontSize:'12px',color:'rgba(255,255,255,0.4)',marginTop:'-8px'}}>
                    Compiling financial modeling engine
                </div>
                <div style={{width:'220px',height:'3px',background:'rgba(255,255,255,0.1)',
                             borderRadius:'99px',overflow:'hidden'}}>
                    <div style={{height:'100%',width:'100%',
                                 background:'linear-gradient(90deg,#3b82f6,#60a5fa)',
                                 borderRadius:'99px',animation:'fmp-pulse 1.5s ease-in-out infinite'}} />
                </div>
                <button onClick={() => backToPortal()}
                    style={{marginTop:'8px',padding:'6px 16px',
                            background:'rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.7)',
                            border:'1px solid rgba(255,255,255,0.2)',borderRadius:'6px',
                            cursor:'pointer',fontSize:'12px',fontFamily:'Inter,sans-serif'}}>
                    ← Back to Portal
                </button>
            </div>
        );
    }

    // REFM platform — ready
    if (activePlatform === 'refm') {
        return <RealEstatePlatform
            onBackToPortal={backToPortal}
            branding={branding}
            onBrandingChange={handleBrandingSave}
            initialRole={currentUserRole}
        />;
    }

    // Fallback (future platforms)
    return (
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',
                     height:'100vh',flexDirection:'column',gap:'var(--sp-2)'}}>
            <div style={{fontSize:'3rem'}}>🚧</div>
            <div style={{fontWeight:'var(--fw-bold)',color:'var(--color-heading)'}}>Platform not yet available</div>
            <button onClick={() => backToPortal()}
                style={{marginTop:'var(--sp-1)',padding:'var(--sp-1) var(--sp-2)',
                        background:'var(--color-primary)',color:'white',border:'none',
                        borderRadius:'var(--radius-sm)',cursor:'pointer',
                        fontWeight:'var(--fw-semibold)',fontSize:'var(--font-body)'}}>
                ← Back to Portal
            </button>
        </div>
    );
}
