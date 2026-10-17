/** @type {import('next').NextConfig} */
const nextConfig = {
  // 7.1 / FQA5: @sparticuz/chromium's Brotli-compressed binary assets are
  // loaded with runtime filesystem operations. Next file tracing cannot infer
  // them from JS imports, so all document-producing handlers MUST include bin.
  // Next.js 14 uses experimental.outputFileTracingIncludes (not the 15+ key).
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    outputFileTracingIncludes: {
      '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
      '/api/export/PDF': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    },
  },
}

module.exports = nextConfig
