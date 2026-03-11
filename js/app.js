// ════════════════════════════════════════════════════════════
//  APP.JS — Entry point
//  Polls every 50ms until AppRoot is defined (Babel compiles
//  files asynchronously), then mounts React and hides loader.
// ════════════════════════════════════════════════════════════

(function () {
    var POLL_MS    = 50;
    var TIMEOUT_MS = 30000;
    var elapsed    = 0;

    function poll() {
        if (typeof AppRoot !== 'undefined') {
            // All files compiled — mount
            try {
                ReactDOM.render(
                    React.createElement(AppRoot),
                    document.getElementById('root')
                );
                if (window._fmpLoaderDone) window._fmpLoaderDone();
            } catch (err) {
                console.error('[FMP] Render failed:', err);
                if (window._fmpLoaderDone) window._fmpLoaderDone();
                document.getElementById('root').innerHTML =
                    '<div style="padding:2rem;color:#991B1B;font-family:Inter,sans-serif">' +
                    '<strong>Render error:</strong> ' + err.message + '</div>';
            }
            return;
        }
        elapsed += POLL_MS;
        if (elapsed >= TIMEOUT_MS) {
            console.error('[FMP] Timeout — AppRoot never defined');
            if (window._fmpLoaderDone) window._fmpLoaderDone();
            return;
        }
        setTimeout(poll, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(poll, POLL_MS); });
    } else {
        setTimeout(poll, POLL_MS);
    }
}());
