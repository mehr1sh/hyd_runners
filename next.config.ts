import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Cache Components is deliberately off for the first release: every
  // session read would otherwise need its own <Suspense> boundary. Revisit
  // before Next.js 17, where it becomes the default.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Leaflet tiles are loaded by Leaflet itself, not next/image.
    remotePatterns: [],
  },
  // Security headers for every route; the policy itself lives in
  // src/lib/security/headers.ts. Values are fixed at build time.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          nodeEnv: process.env.NODE_ENV,
          vercelEnv: process.env.VERCEL_ENV,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          mapTileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL,
        }),
      },
    ];
  },
};

export default nextConfig;
