// Identifies this build. Netlify sets COMMIT_REF; locally we fall back to a
// timestamp. It is stamped into the service worker (src/app/sw.js/route.ts) so
// every deploy is a genuine worker update and stale caches get purged.
const BUILD_ID = process.env.COMMIT_REF?.slice(0, 12) || String(Date.now());

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Lint is intentionally decoupled from the production build for now; type
  // safety (tsc) still gates the build. Add ESLint as a follow-up.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // Allow the root-scoped service worker and keep it fresh.
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        // Baseline security headers.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
