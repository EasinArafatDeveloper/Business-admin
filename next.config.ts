import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (see Dockerfile).
  output: "standalone",
  // Lets a production build run in a separate folder while `next dev` keeps using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // exceljs is a big CommonJS library used only on the server (Excel import).
  serverExternalPackages: ["exceljs", "nodemailer"],
  // OAuth discovery for AI connectors (claude.ai, ChatGPT) lives at fixed /.well-known addresses.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/protected" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/protected" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/server" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata/server" }
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css"
      }
    }
  }
};

export default nextConfig;
