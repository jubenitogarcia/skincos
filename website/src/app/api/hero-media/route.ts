import { getHeroMediaItems } from "@/lib/heroMedia.server";
import type { HeroMediaItem, HeroMediaVariant } from "@/lib/heroMediaShared";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const variantParam = (url.searchParams.get("variant") ?? "").toLowerCase();
    const variant: HeroMediaVariant | undefined = variantParam === "mobile" || variantParam === "desktop" ? (variantParam as HeroMediaVariant) : undefined;
    const unitSlug = (url.searchParams.get("unit") ?? "").trim() || undefined;

    const { items, source, debug: heroDebug } = await getHeroMediaItems({ variant, unitSlug });
    const payload = { items } as {
        items: HeroMediaItem[];
        debug?: {
            source: string;
            count: number;
            scopeCounts: { global: number; unit: number };
            sourceCounts: {
                local: { global: number; unit: number; total: number };
                remote: { global: number; unit: number; total: number };
            };
            remoteStrategy: "scoped_manifest" | "legacy" | "none";
            remoteChannels: { global: string; unit: string };
        };
    };

    if (debug) {
        payload.debug = heroDebug;
    }

    return Response.json(
        payload,
        {
            headers: {
                "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
                "x-hero-source": source,
                "x-hero-items": String(payload.items.length),
            },
        },
    );
}
