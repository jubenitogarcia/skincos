import "server-only";

import { driveListFolderFiles } from "@/lib/googleDrive";
import {
    dedupeHeroMediaItems,
    getLocalHeroItems,
    normalizeHeroUnitSlug,
    type HeroMediaBookingHotspot,
    type HeroMediaItem,
    type HeroMediaVariant,
} from "@/lib/heroMediaShared";

function inferTypeFromMime(mimeType: string): HeroMediaItem["type"] | null {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return null;
}

function unitEnvToken(unitSlug: string | null | undefined): string {
    const normalized = normalizeHeroUnitSlug(unitSlug);
    return normalized ? normalized.toUpperCase() : "";
}

function getDriveFolderIdForVariant(variant: HeroMediaVariant, unitSlug?: string | null): string {
    const token = unitEnvToken(unitSlug);
    if (token) {
        if (variant === "mobile") {
            const unitMobile = process.env[`HERO_DRIVE_FOLDER_ID_MOBILE_${token}`] ?? process.env[`HERO_DRIVE_FOLDER_ID_${token}_MOBILE`];
            if (unitMobile) return unitMobile;
        }

        const unitDefault = process.env[`HERO_DRIVE_FOLDER_ID_${token}`];
        if (unitDefault) return unitDefault;
    }

    const base = process.env.HERO_DRIVE_FOLDER_ID ?? "1jBzRiaBRLZywHChcfT_bUSvO5JGz83BM";
    if (variant === "mobile") return process.env.HERO_DRIVE_FOLDER_ID_MOBILE ?? base;
    return base;
}

function getManifestUrlForVariant(variant: HeroMediaVariant, unitSlug?: string | null): string | null {
    const token = unitEnvToken(unitSlug);
    if (token) {
        if (variant === "mobile") {
            const unitMobile = process.env[`HERO_MEDIA_MANIFEST_URL_MOBILE_${token}`] ?? process.env[`HERO_MEDIA_MANIFEST_URL_${token}_MOBILE`];
            if (unitMobile) return unitMobile;
        }

        const unitDefault = process.env[`HERO_MEDIA_MANIFEST_URL_${token}`];
        if (unitDefault) return unitDefault;
    }

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
                bookingHotspot: parseBookingHotspot(obj.bookingHotspot),
            });
        }

        return items;
    } catch {
        return [];
    }
}

function parseBookingHotspot(value: unknown): HeroMediaBookingHotspot | undefined {
    if (!value || typeof value !== "object") return undefined;
    const hotspot = value as Record<string, unknown>;
    const leftPct = Number(hotspot.leftPct);
    const topPct = Number(hotspot.topPct);
    const widthPct = Number(hotspot.widthPct);
    const heightPct = Number(hotspot.heightPct);

    if (![leftPct, topPct, widthPct, heightPct].every(Number.isFinite)) return undefined;

    return { leftPct, topPct, widthPct, heightPct };
}

type HeroCache = { items: HeroMediaItem[]; source: string; expiresAtMs: number };
const heroCacheByKey: Record<string, HeroCache> = {};
const refreshInFlightByKey: Record<string, Promise<void>> = {};
const HERO_CACHE_TTL_MS = 5 * 60_000;
const HERO_REMOTE_TIMEOUT_MS = 400;

function getHeroCacheKey(variant: HeroMediaVariant, unitSlug?: string | null): string {
    const unitKey = normalizeHeroUnitSlug(unitSlug) || "default";
    return `${variant}:${unitKey}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
}

async function refreshHeroMedia(variant: HeroMediaVariant, unitSlug?: string | null): Promise<void> {
    const cacheKey = getHeroCacheKey(variant, unitSlug);
    if (refreshInFlightByKey[cacheKey]) return refreshInFlightByKey[cacheKey];

    refreshInFlightByKey[cacheKey] = (async () => {
        const manifestUrl = getManifestUrlForVariant(variant, unitSlug);
        const folderId = getDriveFolderIdForVariant(variant, unitSlug);
        const fromManifest = (await withTimeout(getFromManifestUrl(manifestUrl), HERO_REMOTE_TIMEOUT_MS)) ?? [];
        const fromDrive = fromManifest.length ? [] : (await withTimeout(getFromDriveFolder(folderId), HERO_REMOTE_TIMEOUT_MS)) ?? [];
        const remoteItems = fromManifest.length ? fromManifest : fromDrive;
        const items = dedupeHeroMediaItems([...getLocalHeroItems(variant, { unitSlug }), ...remoteItems]);
        const source = remoteItems.length ? "local_and_remote" : "local_only";
        heroCacheByKey[cacheKey] = { items, source, expiresAtMs: Date.now() + HERO_CACHE_TTL_MS };
    })()
        .catch(() => {
            // ignore refresh errors
        })
        .finally(() => {
            delete refreshInFlightByKey[cacheKey];
        });
    return refreshInFlightByKey[cacheKey];
}

export async function getHeroMediaItems(
    options: { variant?: HeroMediaVariant; unitSlug?: string | null } = {},
): Promise<{ items: HeroMediaItem[]; source: string }> {
    const variant = options.variant ?? "desktop";
    const unitSlug = options.unitSlug ?? null;
    const cacheKey = getHeroCacheKey(variant, unitSlug);
    const now = Date.now();
    const existing = heroCacheByKey[cacheKey] ?? null;
    if (existing && existing.expiresAtMs > now) {
        return { items: existing.items, source: existing.source };
    }

    if (existing) {
        void refreshHeroMedia(variant, unitSlug);
        return { items: existing.items, source: existing.source };
    }

    const baseItems = getLocalHeroItems(variant, { unitSlug });
    heroCacheByKey[cacheKey] = { items: [...baseItems], source: "local_only", expiresAtMs: now + HERO_CACHE_TTL_MS };
    void refreshHeroMedia(variant, unitSlug);
    return { items: baseItems, source: "local_only" };
}
