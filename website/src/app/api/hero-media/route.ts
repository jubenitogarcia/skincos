import { getHeroMediaItems } from "@/lib/heroMedia.server";
import type { HeroMediaItem, HeroMediaVariant } from "@/lib/heroMediaShared";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const variantParam = (url.searchParams.get("variant") ?? "").toLowerCase();
    const variant: HeroMediaVariant | undefined = variantParam === "mobile" || variantParam === "desktop" ? (variantParam as HeroMediaVariant) : undefined;

    const { items, source } = await getHeroMediaItems({ variant });
    const payload = { items } as {
        items: HeroMediaItem[];
        debug?: { source: string; count: number };
    };

    if (debug) {
        payload.debug = { source, count: payload.items.length };
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
