import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "./contentSecurityPolicy.mjs";

/** @type {import('next').NextConfig} */
const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA || "";
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "";
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const localPreviewEnabled = process.env.SKINCOS_LOCAL_PREVIEW === "true";
const localPreviewTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const localPreviewDistDirPattern = /^\.next-codex-preview\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function requireLocalPreviewToken(name, value) {
  if (typeof value === "string" && localPreviewTokenPattern.test(value)) {
    return value;
  }

  throw new Error(
    `[skincos-local-preview] ${name} must be a controlled header-safe token when SKINCOS_LOCAL_PREVIEW=true.`,
  );
}

function requireLocalPreviewDistDir(value) {
  if (typeof value === "string" && localPreviewDistDirPattern.test(value)) {
    return value;
  }

  throw new Error(
    "[skincos-local-preview] SKINCOS_LOCAL_PREVIEW_DIST_DIR must be .next-codex-preview/<safe-identity-key> when SKINCOS_LOCAL_PREVIEW=true.",
  );
}

const localPreview = localPreviewEnabled
  ? {
      fingerprint: requireLocalPreviewToken(
        "SKINCOS_LOCAL_PREVIEW_FINGERPRINT",
        process.env.SKINCOS_LOCAL_PREVIEW_FINGERPRINT,
      ),
      instance: requireLocalPreviewToken(
        "SKINCOS_LOCAL_PREVIEW_INSTANCE",
        process.env.SKINCOS_LOCAL_PREVIEW_INSTANCE,
      ),
      distDir: requireLocalPreviewDistDir(process.env.SKINCOS_LOCAL_PREVIEW_DIST_DIR),
    }
  : null;

initOpenNextCloudflareForDev();

const nextConfig = {
  outputFileTracingRoot: appRoot,
  poweredByHeader: false,
  ...(localPreview ? { distDir: localPreview.distDir } : {}),
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
          ...(localPreview
            ? [
                {
                  key: "X-Skincos-Preview-Fingerprint",
                  value: localPreview.fingerprint,
                },
                {
                  key: "X-Skincos-Preview-Instance",
                  value: localPreview.instance,
                },
              ]
            : []),
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
