// ════════════════════════════════════════════════════════════
//  APP.JS — Financial Modeler Pro
//  Safe initialization entry point.
//
//  ROOT CAUSE FIX:
//  @babel/standalone processes type="text/babel" scripts
//  ASYNCHRONOUSLY. The original DOMContentLoaded approach fired
//  before Babel had finished transpiling the other files, so
//  AppRoot / PortalApp / etc. didn't exist yet → blank screen.
//
//  Fix: poll for all required globals with a short interval,
//  then mount once everything is ready (or show a clear error
//  after a generous timeout).
// ════════════════════════════════════════════════════════════

(function () {

    // ── Required globals (defined across the module files) ──
    var REQUIRED = [
        { name: 'React',         label: 'React' },
        { name: 'ReactDOM',      label: 'ReactDOM' },
        { name: 'AppRoot',       label: 'AppRoot (refm-platform.js)' },
        { name: 'ROLES',         label: 'ROLES (settings.js)' },
        { name: 'loadBranding',  label: 'loadBranding (branding.js)' },
        { name: 'loadStorage',   label: 'loadStorage (projects.js)' },
        { name: 'PortalApp',     label: 'PortalApp (portal.js)' },
    ];

    var POLL_INTERVAL_MS = 50;   // check every 50ms
    var TIMEOUT_MS       = 15000; // give up after 15 seconds
    var elapsed          = 0;

    // ── Validate that every required global is present ──
    function validate() {
        return REQUIRED.filter(function (dep) {
            return typeof window[dep.name] === 'undefined';
        });
    }

    // ── Render a readable error screen when something is missing ──
    function showError(missing, timedOut) {
        var root = document.getElementById('root');
        if (!root) return;
        root.innerHTML = [
            '<div style="font-family:Inter,sans-serif;display:flex;align-items:center;',
            'justify-content:center;height:100vh;background:#F5F7FA;">',
            '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;',
            'padding:40px 48px;max-width:520px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">',
            '<div style="font-size:2rem;margin-bottom:16px;">⚠️</div>',
            '<div style="font-size:16px;font-weight:700;color:#0F2B46;margin-bottom:8px;">',
            timedOut ? 'Platform timed out' : 'Platform failed to initialise',
            '</div>',
            '<div style="font-size:13px;color:#6B7280;margin-bottom:20px;line-height:1.6;">',
            timedOut
                ? 'Scripts did not finish loading within 15 seconds. Check your network connection and browser console for errors.'
                : 'One or more required scripts did not load. Check the browser console for errors and confirm all JS files are present in the js/ folder.',
            '</div>',
            '<ul style="font-size:12px;color:#991B1B;background:#FEF2F2;border:1px solid #FECACA;',
            'border-radius:8px;padding:12px 16px;list-style:none;margin:0;">',
            missing.map(function (d) {
                return '<li style="padding:3px 0;">✕ ' + d.label + '</li>';
            }).join(''),
            '</ul>',
            '<div style="margin-top:16px;font-size:12px;color:#9CA3AF;">',
            'Tip: Open DevTools → Console for detailed error messages.',
            '</div>',
            '</div></div>',
        ].join('');
    }

    // ── Mount the React application ──
    function mount() {
        var rootEl = document.getElementById('root');
        if (!rootEl) {
            console.error('[FMP] #root element not found in the DOM.');
            return;
        }

        try {
            ReactDOM.render(
                React.createElement(AppRoot),
                rootEl
            );
            console.info('[FMP] Platform initialised successfully.');
        } catch (err) {
            console.error('[FMP] React render failed:', err);
            showError([{ label: 'React render error — ' + err.message }], false);
        }
    }

    // ── Poll until all globals are ready, then mount ──
    function poll() {
        var missing = validate();

        if (missing.length === 0) {
            // All globals ready — mount!
            console.info('[FMP] All globals loaded. Mounting...');
            mount();
            return;
        }

        elapsed += POLL_INTERVAL_MS;

        if (elapsed >= TIMEOUT_MS) {
            console.error('[FMP] Timeout — missing globals after ' + TIMEOUT_MS + 'ms:', missing.map(function (d) { return d.name; }));
            showError(missing, true);
            return;
        }

        // Not ready yet — try again shortly
        setTimeout(poll, POLL_INTERVAL_MS);
    }

    // ── Start polling once DOM is parsed ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(poll, POLL_INTERVAL_MS);
        });
    } else {
        setTimeout(poll, POLL_INTERVAL_MS);
    }

}());
