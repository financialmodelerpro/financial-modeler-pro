import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Silence the workspace root lockfile warning on Windows/OneDrive paths
  outputFileTracingRoot: path.join(__dirname),

  async rewrites() {
    return {
      beforeFiles: [
        // learn. subdomain — rewrite non-training paths to /training
        {
          source: '/((?!training|api|_next).*)',
          destination: '/training',
          has: [{ type: 'host', value: 'learn.financialmodelerpro.com' }],
        },
        // app. subdomain — rewrite non-app paths to /modeling
        {
          source: '/((?!refm|modeling|settings|api|_next).*)',
          destination: '/modeling',
          has: [{ type: 'host', value: 'app.financialmodelerpro.com' }],
        },
      ],
    };
  },

  async redirects() {
    return [
      // Keep existing slug redirects
      { source: '/modeling-hub',        destination: '/modeling',        permanent: true },
      { source: '/modeling-hub/:path*', destination: '/modeling/:path*', permanent: true },

      // Main domain — redirect /training/* to learn. subdomain
      {
        source: '/training/:path*',
        destination: 'https://learn.financialmodelerpro.com/training/:path*',
        permanent: false,
        missing: [{ type: 'host', value: 'learn.financialmodelerpro.com' }],
      },

      // Main domain — redirect /refm/* to app. subdomain
      {
        source: '/refm/:path*',
        destination: 'https://app.financialmodelerpro.com/refm/:path*',
        permanent: false,
        missing: [{ type: 'host', value: 'app.financialmodelerpro.com' }],
      },

      // Main domain — redirect /modeling/* to app. subdomain
      {
        source: '/modeling/:path*',
        destination: 'https://app.financialmodelerpro.com/modeling/:path*',
        permanent: false,
        missing: [{ type: 'host', value: 'app.financialmodelerpro.com' }],
      },
    ];
  },
};

export default nextConfig;
