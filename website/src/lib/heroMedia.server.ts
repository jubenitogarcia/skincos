import "server-only";

import { driveListFolderFiles } from "@/lib/googleDrive";
import { dedupeHeroMediaItems, getLocalHeroItems, type HeroMediaItem, type HeroMediaVariant } from "@/lib/heroMediaShared";

function inferTypeFromMime(mimeType: string): HeroMediaItem["type"] | null {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return null;
}

function getDriveFolderIdForVariant(variant: HeroMediaVariant): string {
    const base = process.env.HERO_DRIVE_FOLDER_ID ?? "1jBzRiaBRLZywHChcfT_bUSvO5JGz83BM";
    if (variant === "mobile") return process.env.HERO_DRIVE_FOLDER_ID_MOBILE ?? base;
    return base;
}

function getManifestUrlForVariant(variant: HeroMediaVariant): string | null {
    const base = process.env.HERO_MEDIA_MANIFEST_URL ?? null;
    if (variant === "mobile") return process.env.HERO_MEDIA_MANIFEST_URL_MOBILE ?? base;
    return base;
}

export function heroVariantFromUserAgent(ua: string | null | undefined): HeroMediaVariant {
    const value = (ua ?? "").toLowerCase();
    if (!value) return "desktop";
    if (/(iphone|ipod|ipad|android|mobile|windows phone|iemobile|blackberry)/i.test(value)) {
        return "mobile";
    }
    return "desktop";
}

async function getFromDriveFolder(folderId: string): Promise<HeroMediaItem[]> {
    const hasServiceAccount =
        Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) ||
        Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    if (!hasServiceAccount) return [];

    try {
        const files = await driveListFolderFiles(folderId);
        const items: HeroMediaItem[] = [];

        for (const file of files) {
            const type = inferTypeFromMime(file.mimeType);
            if (!type) continue;

            items.push({
                type,
                src: `/api/drive-media/${encodeURIComponent(file.id)}`,
                alt: file.name ?? "",
            });
        }

        return items;
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        console.warn("hero-media: drive folder load failed", message);
        return [];
    }
}

async function getFromManifestUrl(manifestUrl: string | null): Promise<HeroMediaItem[]> {
    if (!manifestUrl) return [];

    try {
        const resp = await fetch(manifestUrl, { headers: { Accept: "application/json" } });
        if (!resp.ok) return [];

        const data = (await resp.json()) as unknown;
        if (!Array.isArray(data)) return [];

        const items: HeroMediaItem[] = [];
        for (const raw of data) {
            if (!raw || typeof raw !== "object") continue;
            const obj = raw as Record<string, unknown>;
            const type = obj.type;
            const src = obj.src;
            if ((type !== "image" && type !== "video") || typeof src !== "string") continue;

            items.push({
                type,
                src,
                alt: typeof obj.alt === "string" ? obj.alt : undefined,
            });
        }

        return items;
    } catch {
        return [];
    }
}

type HeroCache = { items: HeroMediaItem[]; source: string; expiresAtMs: number };
const heroCacheByVariant: Partial<Record<HeroMediaVariant, HeroCache>> = {};
const refreshInFlightByVariant: Partial<Record<HeroMediaVariant, Promise<void>>> = {};
const HERO_CACHE_TTL_MS = 5 * 60_000;
const HERO_REMOTE_TIMEOUT_MS = 400;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
}

async function refreshHeroMedia(variant: HeroMediaVariant): Promise<void> {
    if (refreshInFlightByVariant[variant]) return refreshInFlightByVariant[variant]!;
    refreshInFlightByVariant[variant] = (async () => {
        const manifestUrl = getManifestUrlForVariant(variant);
        const folderId = getDriveFolderIdForVariant(variant);
        const fromManifest = (await withTimeout(getFromManifestUrl(manifestUrl), HERO_REMOTE_TIMEOUT_MS)) ?? [];
        const fromDrive = fromManifest.length ? [] : (await withTimeout(getFromDriveFolder(folderId), HERO_REMOTE_TIMEOUT_MS)) ?? [];
        const remoteItems = fromManifest.length ? fromManifest : fromDrive;
        const items = dedupeHeroMediaItems([...getLocalHeroItems(variant), ...remoteItems]);
        const source = remoteItems.length ? "local_and_remote" : "local_only";
        heroCacheByVariant[variant] = { items, source, expiresAtMs: Date.now() + HERO_CACHE_TTL_MS };
    })()
        .catch(() => {
            // ignore refresh errors
        })
        .finally(() => {
            delete refreshInFlightByVariant[variant];
        });
    return refreshInFlightByVariant[variant]!;
}

export async function getHeroMediaItems(
    options: { variant?: HeroMediaVariant } = {},
): Promise<{ items: HeroMediaItem[]; source: string }> {
    const variant = options.variant ?? "desktop";
    const now = Date.now();
    const existing = heroCacheByVariant[variant] ?? null;
    if (existing && existing.expiresAtMs > now) {
        return { items: existing.items, source: existing.source };
    }

    if (existing) {
        void refreshHeroMedia(variant);
        return { items: existing.items, source: existing.source };
    }

    const baseItems = getLocalHeroItems(variant);
    heroCacheByVariant[variant] = { items: [...baseItems], source: "local_only", expiresAtMs: now + HERO_CACHE_TTL_MS };
    void refreshHeroMedia(variant);
    return { items: baseItems, source: "local_only" };
}
