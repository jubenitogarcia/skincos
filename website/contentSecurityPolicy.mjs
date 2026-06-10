export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://www.gstatic.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net https://graph.facebook.com https://www.google.com https://maps.googleapis.com https://maps.gstatic.com https://unavatar.io https://*.cdninstagram.com https://*.fbcdn.net https://*.instagram.com https://cloudflareinsights.com https://*.cloudflareinsights.com",
  "frame-src 'self' https://www.google.com https://maps.google.com https://www.google.com.br",
  "media-src 'self' data: blob: https:",
].join("; ");
