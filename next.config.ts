import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (see Dockerfile).
  output: "standalone",
  // Lets a production build run in a separate folder while `next dev` keeps using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // exceljs is a big CommonJS library used only on the server (Excel import).
  serverExternalPackages: ["exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
