/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Limit request body size to 10 MB (default is unlimited).
  // Bill-import PDF uploads are the largest payloads; 10 MB is generous.
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
          // Hardening for the JSON API. The SPA's own headers (incl. CSP) are
          // set by the reverse proxy that serves it — see deploy/Caddyfile.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
