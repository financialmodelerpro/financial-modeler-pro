import type { NextConfig } from "next";
import path from "path";

const MAIN_URL  = 'https://financialmodelerpro.com';
const LEARN_URL = 'https://learn.financialmodelerpro.com';
const APP_URL   = 'https://app.financialmodelerpro.com';

// Paths that belong to the main domain — redirect these back from subdomains
const MAIN_PATHS = [
  '/about', '/articles', '/pricing', '/contact', '/login',
  '/forgot-password', '/reset-password', '/admin', '/portal',
  '/verify', '/t', '/testimonials', '/confidentiality', '/privacy-policy',
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
      {
        source: '/training-sessions',
        destination: `${LEARN_URL}/training-sessions`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'financialmodelerpro.com' }],
      },
      {
        source: '/training-sessions/:id',
        destination: `${LEARN_URL}/training-sessions/:id`,
        permanent: false,
        has: [{ type: 'host' as const, value: 'financialmodelerpro.com' }],
      },

      // Main domain → learn. for /training/*
      {
        source: '/training/:path*',
        destination: `${LEARN_URL}/training/:path*`,
        permanent: false,
        missing: [{ type: 'host' as const, value: 'learn.financialmodelerpro.com' }],
      },

      // Main domain → app. for /refm/* and /modeling/*
      {
        source: '/refm/:path*',
        destination: `${APP_URL}/refm/:path*`,
        permanent: false,
        missing: [{ type: 'host' as const, value: 'app.financialmodelerpro.com' }],
      },
      {
        source: '/modeling/:path*',
        destination: `${APP_URL}/modeling/:path*`,
        permanent: false,
        missing: [{ type: 'host' as const, value: 'app.financialmodelerpro.com' }],
      },
    ];
  },
};

export default nextConfig;
