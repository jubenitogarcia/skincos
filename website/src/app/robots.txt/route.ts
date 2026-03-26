import { NextResponse } from "next/server";
import { getSiteConfigFromHost } from "@/lib/site-config";

export function GET(request: Request) {
  const site = getSiteConfigFromHost(new URL(request.url).host);
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /_next/",
    `Sitemap: ${site.siteUrl}/sitemap.xml`,
    "",
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
