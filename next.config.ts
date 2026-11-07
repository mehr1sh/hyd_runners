import type { NextConfig } from "next";

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
};

export default nextConfig;
