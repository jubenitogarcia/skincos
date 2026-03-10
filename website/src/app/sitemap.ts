import type { MetadataRoute } from "next";
import { units } from "@/data/units";
import { doctors } from "@/data/doctors";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();

    const staticRoutes: MetadataRoute.Sitemap = [
        { url: `${siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
        { url: `${siteUrl}/barrashoppingsul`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
        { url: `${siteUrl}/novohamburgo`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
        { url: `${siteUrl}/agendamento`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
        { url: `${siteUrl}/unidades`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
        { url: `${siteUrl}/doutores`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
        { url: `${siteUrl}/sobre`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
        { url: `${siteUrl}/privacidade`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
        { url: `${siteUrl}/termos`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    ];

    const unitRoutes: MetadataRoute.Sitemap = units.map((unit) => ({
        url: `${siteUrl}/${unit.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.7,
    }));

    const doctorRoutes: MetadataRoute.Sitemap = doctors.map((doctor) => ({
        url: `${siteUrl}/doutores/${doctor.slug}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.6,
    }));

    const deduped = new Map<string, MetadataRoute.Sitemap[number]>();
    for (const entry of [...staticRoutes, ...unitRoutes, ...doctorRoutes]) {
        deduped.set(entry.url, entry);
    }

    return [...deduped.values()];
}
