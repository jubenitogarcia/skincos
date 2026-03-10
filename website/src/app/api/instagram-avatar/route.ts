import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INSTAGRAM_APP_ID = "936619743392459";

type InstagramWebProfileInfo = {
    data?: {
        user?: {
            profile_pic_url_hd?: string;
            profile_pic_url?: string;
        };
    };
};

type CfCacheStorage = {
    default?: Cache;
};

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function escapeXml(input: string): string {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function initialsFromName(input: string): string {
    const cleaned = input
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N} ._-]/gu, "");

    if (!cleaned) return "EF";

    const parts = cleaned.split(" ").filter(Boolean);
    const first = parts[0]?.[0] ?? cleaned[0];
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
    const result = (first + last).toUpperCase();

    // Fallback to first 2 characters if we couldn't compose well.
    return result.replace(/\s/g, "").slice(0, 2) || cleaned.slice(0, 2).toUpperCase();
}

function placeholderSvg(initials: string): string {
    const safe = escapeXml(initials.slice(0, 2).toUpperCase());
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label="${safe}">
    <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#0f172a"/>
            <stop offset="1" stop-color="#334155"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="56" height="56" rx="14" fill="url(#g)"/>
    <text x="28" y="33" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="18" font-weight="700" fill="#ffffff">${safe}</text>
</svg>`;
}

function decodeHtmlEntities(input: string): string {
    return input
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)));
}

function extractOgImage(html: string): string | null {
    const metaTags = html.match(/<meta\b[^>]*>/gi);
    if (!metaTags) return null;

    for (const tag of metaTags) {
        const attrs: Record<string, string> = {};

        for (const m of tag.matchAll(
            /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
        )) {
            const attrName = m[1].toLowerCase();
            const rawValue = m[3] ?? m[4] ?? m[5] ?? "";
            attrs[attrName] = decodeHtmlEntities(rawValue);
        }

        const prop = (attrs["property"] ?? attrs["name"] ?? "").toLowerCase();
        if (prop === "og:image" && attrs["content"]) {
            return attrs["content"];
        }
    }

    return null;
}

async function fetchInstagramOgImage(handle: string): Promise<string | null> {
    const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;

    const res = await fetch(url, {
        redirect: "follow",
        headers: {
            // A realistic UA helps avoid some bot blocks.
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        // Cache at our edge for a bit.
        next: { revalidate: 60 * 60 },
    });

    if (!res.ok) return null;
    const html = await res.text();
    return extractOgImage(html);
}

async function fetchInstagramProfilePic(handle: string): Promise<string | null> {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

    const res = await fetch(url, {
        redirect: "follow",
        headers: {
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            accept: "application/json,text/plain,*/*",
            "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
            // Header used by Instagram web.
            "x-ig-app-id": INSTAGRAM_APP_ID,
            // Helps some bot protections treat this like a browser-originated request.
            origin: "https://www.instagram.com",
            referer: "https://www.instagram.com/",
        },
        next: { revalidate: 60 * 60 },
    });

    if (!res.ok) return null;

    // Some Instagram endpoints may prefix JSON with `for (;;);`
    const raw = await res.text();
    const cleaned = raw.replace(/^for \(;;\);\s*/, "");

    try {
        const json = JSON.parse(cleaned) as InstagramWebProfileInfo;
        const hd = json.data?.user?.profile_pic_url_hd;
        const standard = json.data?.user?.profile_pic_url;
        return typeof hd === "string" ? hd : typeof standard === "string" ? standard : null;
    } catch {
        return null;
    }
}

async function fetchImage(url: string): Promise<{ ok: boolean; contentType: string | null; bytes: ArrayBuffer | null }> {
    try {
        const res = await fetch(url, {
            redirect: "follow",
            headers: {
                "user-agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
            next: { revalidate: 60 * 60 * 12 },
        });

        const contentType = res.headers.get("content-type");
        if (!res.ok) return { ok: false, contentType, bytes: null };
        if (!contentType || !contentType.toLowerCase().startsWith("image/")) {
            return { ok: false, contentType, bytes: null };
        }

        return { ok: true, contentType, bytes: await res.arrayBuffer() };
    } catch {
        return { ok: false, contentType: null, bytes: null };
    }
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const handleRaw = (searchParams.get("handle") ?? "").trim();
    const handle = handleRaw.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "");
    const nameParam = (searchParams.get("name") ?? "").trim();

    if (!handle) {
        return new NextResponse("missing_handle", { status: 400 });
    }

    try {
        const cache = getCloudflareCache();
        const cacheKey = new Request(`https://espacofacial.com/__cache/instagram-avatar/${encodeURIComponent(handle)}`);

        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                const bytes = await hit.arrayBuffer();
                return new NextResponse(bytes, {
                    status: 200,
                    headers: {
                        "content-type": hit.headers.get("content-type") ?? "image/jpeg",
                        "cache-control": hit.headers.get("cache-control") ?? "public, max-age=86400",
                        "x-avatar-source": hit.headers.get("x-avatar-source") ?? "cache",
                    },
                });
            }
        }

        const profilePicUrl = await fetchInstagramProfilePic(handle);
        const ogImageUrl = profilePicUrl ? null : await fetchInstagramOgImage(handle);
        const primaryUrl = profilePicUrl ?? ogImageUrl;

        const source = profilePicUrl ? "profile_json" : ogImageUrl ? "og_image" : "placeholder_svg";

        const primary = primaryUrl ? await fetchImage(primaryUrl) : { ok: false, contentType: null, bytes: null };
        if (primary.ok && primary.bytes) {
            const resp = new NextResponse(primary.bytes, {
                status: 200,
                headers: {
                    "content-type": primary.contentType ?? "image/jpeg",
                    "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=604800",
                    "x-avatar-source": source,
                },
            });

            if (cache) {
                // Cache only real avatars (never placeholders).
                void cache.put(cacheKey, resp.clone());
            }

            return resp;
        }

        const initials = initialsFromName(nameParam || handle);
        const svg = placeholderSvg(initials);
        return new NextResponse(svg, {
            status: 200,
            headers: {
                "content-type": "image/svg+xml; charset=utf-8",
                "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400",
                "x-avatar-source": "placeholder_svg",
            },
        });
    } catch {
        return new NextResponse("error", { status: 500 });
    }
}
