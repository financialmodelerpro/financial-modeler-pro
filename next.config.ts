import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Silence the workspace root lockfile warning on Windows/OneDrive paths
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
