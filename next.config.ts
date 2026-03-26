import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Silence the workspace root lockfile warning on Windows/OneDrive paths
  outputFileTracingRoot: path.join(__dirname),
  async redirects() {
    return [
      { source: '/modeling-hub', destination: '/modeling', permanent: true },
      { source: '/modeling-hub/:path*', destination: '/modeling/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
