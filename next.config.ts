import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const realtime = supabase.replace(/^http/, "ws");
const dev = process.env.NODE_ENV !== "production";

// Practical CSP for Next.js. Next injects small inline bootstrap scripts, so script-src needs 'unsafe-inline' unless every page is
// rendered dynamically with per-request nonces (which would disable static prerendering of the landing page). Everything else is locked
// down: same-origin only, no plugins, no framing, no external form posts, connections only to this origin and the Supabase API/Realtime.
// 'unsafe-eval' is development-only (React refresh).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${realtime}${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`.trim(),
  "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

const PRIVATE = ["/dashboard/:path*", "/api/:path*", "/auth/:path*", "/notifications", "/login", "/register", "/forgot-password", "/reset-password", "/suspended"];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }, // ignored over plain http (local dev)
      ] },
      // Authenticated or sensitive routes must never be stored by browsers, proxies or the service worker.
      ...PRIVATE.map((source) => ({ source, headers: [{ key: "Cache-Control", value: "no-store, private" }] })),
    ];
  },
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
