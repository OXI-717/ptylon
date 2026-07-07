import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-pty", "better-sqlite3"],
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
