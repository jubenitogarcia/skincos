import { NextResponse } from "next/server";
import { units } from "@/data/units";
import { doctors } from "@/data/doctors";
import { getSiteConfigFromHost } from "@/lib/site-config";

function toXml(urls: string[]) {
  const now = new Date().toISOString();
  const body = urls
    .map(
      (url) => `<url><loc>${url}</loc><lastmod>${now}</lastmod><changefreq>${
        url.endsWith("/privacidade") || url.endsWith("/termos") || url.endsWith("/dados")
          ? "yearly"
          : "weekly"
      }</changefreq></url>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function GET(request: Request) {
  const site = getSiteConfigFromHost(new URL(request.url).host);
  const baseUrl = site.siteUrl.replace(/\/$/, "");

  const urls =
    site.key === "skincos"
      ? [`${baseUrl}/`, `${baseUrl}/privacidade`, `${baseUrl}/dados`, `${baseUrl}/termos`]
      : [
          `${baseUrl}/`,
          `${baseUrl}/barrashoppingsul`,
          `${baseUrl}/novohamburgo`,
          `${baseUrl}/agendamento`,
          `${baseUrl}/cadastro`,
          `${baseUrl}/unidades`,
          `${baseUrl}/doutores`,
          `${baseUrl}/sobre`,
          `${baseUrl}/privacidade`,
          `${baseUrl}/termos`,
          ...units.map((unit) => `${baseUrl}/${unit.slug}`),
          ...doctors.map((doctor) => `${baseUrl}/doutores/${doctor.slug}`),
        ];

  return new NextResponse(toXml([...new Set(urls)]), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
