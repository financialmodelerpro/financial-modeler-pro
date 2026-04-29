import type { NextConfig } from "next";
import path from "path";

const MAIN_URL  = 'https://financialmodelerpro.com';
const LEARN_URL = 'https://learn.financialmodelerpro.com';
const APP_URL   = 'https://app.financialmodelerpro.com';

// Paths that belong to the main domain — redirect these back from subdomains.
// `/verify` deliberately NOT in this list: certificate verification is Training
// Hub content and should stay on learn.* (that's the host the QR codes encode
// and the host users should see in their address bar when scanning).
const MAIN_PATHS = [
  '/about', '/articles', '/pricing', '/contact', '/login',
  '/forgot-password', '/reset-password', '/admin', '/portal',
  '/t', '/testimonials', '/confidentiality', '/privacy-policy',
];

const nextConfig: NextConfig = {
  // Silence the workspace root lockfile warning on Windows/OneDrive paths
  outputFileTracingRoot: path.join(__dirname),

  // Native packages that webpack should not bundle — loaded at runtime instead
  serverExternalPackages: ['satori'],

  async headers() {
    return [
      {
        source: '/login',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
      {
        source: '/admin/login',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        // learn. root → serve /training page (no redirect, clean URL)
        {
          source: '/',
          destination: '/training',
          has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }],
        },
        // learn. clean auth URLs
        { source: '/signin',   destination: '/training/signin',   has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }] },
        { source: '/register', destination: '/training/register', has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }] },
        { source: '/forgot',   destination: '/training/forgot',   has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }] },
        // learn. /training-sessions → app/training-sessions/ pages
        { source: '/training-sessions',     destination: '/training-sessions',      has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }] },
        { source: '/training-sessions/:id', destination: '/training-sessions/:id',  has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }] },
        // app. root → serve /modeling page (no redirect, clean URL)
        {
          source: '/',
          destination: '/modeling',
          has: [{ type: 'host', value: 'app.financialmodelerpro.com' }],
        },
        // app. clean auth URLs
        { source: '/signin',   destination: '/modeling/signin',             has: [{ type: 'host', value: 'app.financialmodelerpro.com' }] },
        { source: '/register', destination: '/modeling/register',            has: [{ type: 'host', value: 'app.financialmodelerpro.com' }] },
      ],
    };
  },

  async redirects() {
    // Vercel's project domain config sets `www.financialmodelerpro.com` as the
    // primary host, so apex `financialmodelerpro.com` auto-redirects to www at
    // the edge BEFORE next.config.ts runs. That means a `has: [{ type: 'host',
    // value: 'financialmodelerpro.com' }]` rule (apex literal) will never fire
    // on the canonical host. Use a regex that matches both forms so the rule
    // catches the request after Vercel's apex→www hop and forwards to the
    // subdomain in a single additional 308.
    //
    // Google Search Console flagged /training, /training-sessions and /contact
    // as "Redirect error" because:
    //   - /training: apex→www→learn (multi-hop, all 307 temporary)
    //   - /training-sessions: apex→www but rule never fired on www, so the
    //     page rendered on www with a canonical pointing at learn — a
    //     canonical-vs-served-content conflict
    //   - /contact: apex→www but the canonical tag still points at apex, so
    //     Google reads a canonical that itself redirects (not fixable in
    //     next.config.ts; needs `NEXT_PUBLIC_MAIN_URL` to be updated to the
    //     www form, or Vercel's primary domain to be flipped to apex).
    const MAIN_HOST_RE = '(www\\.)?financialmodelerpro\\.com';

    const learnToMain = MAIN_PATHS.flatMap(p => [
      // exact path
      {
        source: p,
        destination: `${MAIN_URL}${p}`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }],
      },
      // path + sub-paths
      {
        source: `${p}/:rest*`,
        destination: `${MAIN_URL}${p}/:rest*`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }],
      },
    ]);

    const appToMain = MAIN_PATHS.flatMap(p => [
      {
        source: p,
        destination: `${MAIN_URL}${p}`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'app.financialmodelerpro.com' }],
      },
      {
        source: `${p}/:rest*`,
        destination: `${MAIN_URL}${p}/:rest*`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'app.financialmodelerpro.com' }],
      },
    ]);

    return [
      // ── Admin auth legacy URLs ─────────────────────────────────────
      // Belt-and-suspenders: middleware (src/middleware.ts) is the
      // primary handler for /login + /admin/login because it can
      // attach explicit no-cache headers and emit 307. These
      // edge-level 307s (permanent: false) are a backup in case
      // middleware is stale on a given deployment or the matcher
      // misses on a platform-specific path-to-regexp edge case.
      // permanent: false -> 307 Temporary Redirect (session-scoped
      // browser cache vs 308's permanent cache).
      { source: '/login',       destination: '/admin', permanent: false },
      { source: '/admin/login', destination: '/admin', permanent: false },
      // Common typo: /admi -> /admin (users missing the trailing n).
      { source: '/admi',        destination: '/admin', permanent: false },

      // learn. — old /training/* auth paths redirect to clean URLs
      { source: '/training/signin',   destination: '/signin',   permanent: false, has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }] },
      { source: '/training/register', destination: '/register', permanent: false, has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }] },
      { source: '/training/login',    destination: '/signin',   permanent: false, has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }] },
      { source: '/training/forgot',   destination: '/forgot',   permanent: false, has: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }] },

      // Existing slug redirects
      { source: '/modeling-hub',        destination: '/modeling',        permanent: true },
      { source: '/modeling-hub/:path*', destination: '/modeling/:path*', permanent: true },
      // /about page deleted — founder profile is the single source
      { source: '/about',               destination: '/about/ahmad-din', permanent: true },

      // Subdomains → main domain for main-site paths
      ...learnToMain,
      ...appToMain,

      // Main domain → learn. for /training-sessions/*
      // permanent: true (308) so Google understands the canonical host is
      // learn.* and not main. Host regex matches apex AND www.
      {
        source: '/training-sessions',
        destination: `${LEARN_URL}/training-sessions`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },
      {
        source: '/training-sessions/:id',
        destination: `${LEARN_URL}/training-sessions/:id`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },

      // Main domain → learn. for /verify/*. Certificates scanned from a PDF
      // that was generated with the old main-domain QR (pre-migration 113)
      // still resolve — the browser just lands on the learn.* host where the
      // page is canonically served.
      {
        source: '/verify/:id',
        destination: `${LEARN_URL}/verify/:id`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },

      // Main domain → learn. for /training/*
      // 308 + explicit main-host match (apex|www) so the rule fires after
      // Vercel's apex→www hop. The previous `missing: [{ host: 'learn' }]`
      // form fired on www correctly but used 307, which Google treats as a
      // temporary move and may not pass full ranking signals.
      {
        source: '/training/:path*',
        destination: `${LEARN_URL}/training/:path*`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },

      // Main domain → app. for /signin (Modeling Hub auth host).
      // Restores the post-signin /portal → /signin chain when a session
      // expires: /portal is served on main (it's in MAIN_PATHS), so the
      // unauth handler's `router.replace('/signin')` resolves to main —
      // which has no /signin route and 404s without this rule. 307
      // (temporary) so the destination can change without long-lived
      // browser cache. Host regex matches both apex and www.
      {
        source: '/signin',
        destination: `${APP_URL}/signin`,
        permanent: false,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },

      // Main domain → app. for /refm/* and /modeling/*
      {
        source: '/refm/:path*',
        destination: `${APP_URL}/refm/:path*`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },
      {
        source: '/modeling/:path*',
        destination: `${APP_URL}/modeling/:path*`,
        permanent: true,
        has: [{ type: 'host' as const, value: MAIN_HOST_RE }],
      },
    ];
  },
};

export default nextConfig;
