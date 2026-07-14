import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "./contentSecurityPolicy.mjs";

/** @type {import('next').NextConfig} */
const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA || "";
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "";
const appRoot = path.dirname(fileURLToPath(import.meta.url));

initOpenNextCloudflareForDev();

const nextConfig = {
  outputFileTracingRoot: appRoot,
  poweredByHeader: false,
  images: {
    // Keep explicit local image patterns so cache-busted local assets remain valid in Next 16.
    localPatterns: [
      { pathname: "/logo.png" },
      { pathname: "/logo-white.png" },
      { pathname: "/mark.png" },
      { pathname: "/mark-white.png" },
      { pathname: "/images/**" },
      { pathname: "/icon.svg" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "unavatar.io",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.cdninstagram.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.fbcdn.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.instagram.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Helps validate which deployment is currently served (useful when debugging caching / stale deploys).
          { key: "X-App-Build", value: buildSha || "unknown" },
          { key: "X-App-Build-Time", value: buildTime || "" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy.replace(/\s{2,}/g, " ").trim(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
