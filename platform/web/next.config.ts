import type { NextConfig } from "next";

/**
 * Static security headers.
 *
 * The Content-Security-Policy is NOT set here — it carries a per-request nonce
 * and is issued by `src/middleware.ts`. Setting a second, nonce-free CSP at
 * this layer would be additive: browsers enforce every policy they are given,
 * and the stricter one would block the very scripts the nonce exists to allow.
 */
const securityHeaders = [
  // Clickjacking: the dashboard is never legitimately framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // The dataset is personal data; keep it out of shared caches entirely.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The version banner is free reconnaissance for an attacker.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The candidate dataset must never be cached by a proxy or CDN: it is
        // personal data and, once the API serves it per-role, the response
        // differs per user.
        source: "/data/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },

  experimental: {
    // Trim the icon and chart barrels so a page only ships what it imports.
    optimizePackageImports: ["lucide-react", "recharts", "echarts"],
  },
};

export default nextConfig;
