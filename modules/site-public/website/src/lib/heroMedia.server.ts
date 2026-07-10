import "server-only";

import { driveListFolderFiles } from "@/lib/googleDrive";
import {
    composeHeroMediaItems,
    getLocalHeroItemsByScope,
    normalizeHeroMediaScope,
    normalizeHeroUnitSlug,
    resolveScopedHeroMediaItems,
    type HeroMediaBookingHotspot,
    type HeroMediaItem,
    type HeroMediaScope,
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

function toUnitScope(unitSlug: string | null | undefined): HeroMediaScope | null {
    const normalized = normalizeHeroUnitSlug(unitSlug);
    return normalized ? (`unit:${normalized}` as HeroMediaScope) : null;
}

function getScopedManifestUrlForVariant(variant: HeroMediaVariant): string | null {
    if (variant === "mobile") {
        return (
            process.env.HERO_MEDIA_SCOPED_MANIFEST_URL_MOBILE ??
            process.env.HERO_MEDIA_MANIFEST_URL_SCOPED_MOBILE ??
            process.env.HERO_MEDIA_MANIFEST_URL_MOBILE_SCOPED ??
            null
        );
    }
    return process.env.HERO_MEDIA_SCOPED_MANIFEST_URL ?? process.env.HERO_MEDIA_MANIFEST_URL_SCOPED ?? null;
}

function getLegacyGlobalManifestUrlForVariant(variant: HeroMediaVariant): string | null {
    const base = process.env.HERO_MEDIA_MANIFEST_URL ?? null;
    if (variant === "mobile") return process.env.HERO_MEDIA_MANIFEST_URL_MOBILE ?? base;
    return base;
}

function getLegacyUnitManifestUrlForVariant(variant: HeroMediaVariant, unitSlug?: string | null): string | null {
    const token = unitEnvToken(unitSlug);
    if (!token) return null;
    if (variant === "mobile") {
        return process.env[`HERO_MEDIA_MANIFEST_URL_MOBILE_${token}`] ?? process.env[`HERO_MEDIA_MANIFEST_URL_${token}_MOBILE`] ?? null;
    }
    return process.env[`HERO_MEDIA_MANIFEST_URL_${token}`] ?? null;
}

function getLegacyGlobalDriveFolderIdForVariant(variant: HeroMediaVariant): string | null {
    const base = process.env.HERO_DRIVE_FOLDER_ID ?? "1jBzRiaBRLZywHChcfT_bUSvO5JGz83BM";
    if (variant === "mobile") return process.env.HERO_DRIVE_FOLDER_ID_MOBILE ?? base;
    return base;
}

function getLegacyUnitDriveFolderIdForVariant(variant: HeroMediaVariant, unitSlug?: string | null): string | null {
    const token = unitEnvToken(unitSlug);
    if (!token) return null;
    if (variant === "mobile") {
        return process.env[`HERO_DRIVE_FOLDER_ID_MOBILE_${token}`] ?? process.env[`HERO_DRIVE_FOLDER_ID_${token}_MOBILE`] ?? null;
    }
    return process.env[`HERO_DRIVE_FOLDER_ID_${token}`] ?? null;
}

function normalizeOrder(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

export function heroVariantFromUserAgent(ua: string | null | undefined): HeroMediaVariant {
    const value = (ua ?? "").toLowerCase();
    if (!value) return "desktop";
    if (/(iphone|ipod|ipad|android|mobile|windows phone|iemobile|blackberry)/i.test(value)) {
        return "mobile";
    }
    return "desktop";
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

function parseManifestItem(raw: unknown, defaultScope: HeroMediaScope): HeroMediaItem | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const type = obj.type;
    const src = obj.src;
    if ((type !== "image" && type !== "video") || typeof src !== "string" || !src.trim()) return null;

    const normalizedScope = normalizeHeroMediaScope(typeof obj.scope === "string" ? obj.scope : null) ?? defaultScope;
    const enabled = typeof obj.enabled === "boolean" ? obj.enabled : undefined;

    return {
        type,
        src: src.trim(),
        id: normalizeId(obj.id),
        alt: typeof obj.alt === "string" ? obj.alt : undefined,
        width: normalizePositiveNumber(obj.width),
        height: normalizePositiveNumber(obj.height),
        aspectRatio: typeof obj.aspectRatio === "string" ? obj.aspectRatio.trim() || undefined : undefined,
        scope: normalizedScope,
        enabled,
        order: normalizeOrder(obj.order),
        bookingHotspot: parseBookingHotspot(obj.bookingHotspot),
    };
}

async function getFromDriveFolder(folderId: string | null, defaultScope: HeroMediaScope): Promise<HeroMediaItem[]> {
    if (!folderId) return [];

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
                id: normalizeId(file.id),
                type,
                src: `/api/drive-media/${encodeURIComponent(file.id)}`,
                alt: file.name ?? "",
                scope: defaultScope,
            });
        }

        return items;
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        console.warn("hero-media: drive folder load failed", message);
        return [];
    }
}

async function getFromManifestUrl(manifestUrl: string | null, defaultScope: HeroMediaScope): Promise<HeroMediaItem[]> {
    if (!manifestUrl) return [];

    try {
        const resp = await fetch(manifestUrl, { headers: { Accept: "application/json" } });
        if (!resp.ok) return [];

        const data = (await resp.json()) as unknown;
        if (!Array.isArray(data)) return [];

        const items: HeroMediaItem[] = [];
        for (const raw of data) {
            const parsed = parseManifestItem(raw, defaultScope);
            if (!parsed) continue;
            items.push(parsed);
        }

        return items;
    } catch {
        return [];
    }
}

type HeroCacheDebug = {
    source: string;
    count: number;
    scopeCounts: {
        global: number;
        unit: number;
    };
    sourceCounts: {
        local: { global: number; unit: number; total: number };
        remote: { global: number; unit: number; total: number };
    };
    remoteStrategy: "scoped_manifest" | "legacy" | "none";
    remoteChannels: {
        global: string;
        unit: string;
    };
};

type HeroCache = { items: HeroMediaItem[]; source: string; debug: HeroCacheDebug; expiresAtMs: number };
const heroCacheByKey: Record<string, HeroCache> = {};
const refreshInFlightByKey: Partial<Record<string, Promise<void>>> = {};
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

type LegacyScopeLoad = {
    items: HeroMediaItem[];
    channel: "manifest" | "drive" | "none";
};

async function loadLegacyScopeItems(options: {
    variant: HeroMediaVariant;
    unitSlug?: string | null;
    scope: "global" | "unit";
}): Promise<LegacyScopeLoad> {
    const unitScope = toUnitScope(options.unitSlug);
    const fallbackScope: HeroMediaScope = options.scope === "global" ? "global" : unitScope ?? "global";
    const manifestUrl =
        options.scope === "global"
            ? getLegacyGlobalManifestUrlForVariant(options.variant)
            : getLegacyUnitManifestUrlForVariant(options.variant, options.unitSlug);
    const driveFolderId =
        options.scope === "global"
            ? getLegacyGlobalDriveFolderIdForVariant(options.variant)
            : getLegacyUnitDriveFolderIdForVariant(options.variant, options.unitSlug);

    const fromManifest = (await withTimeout(getFromManifestUrl(manifestUrl, fallbackScope), HERO_REMOTE_TIMEOUT_MS)) ?? [];
    if (fromManifest.length > 0) {
        return { items: fromManifest, channel: "manifest" };
    }

    const fromDrive = (await withTimeout(getFromDriveFolder(driveFolderId, fallbackScope), HERO_REMOTE_TIMEOUT_MS)) ?? [];
    if (fromDrive.length > 0) {
        return { items: fromDrive, channel: "drive" };
    }

    return { items: [], channel: "none" };
}

type RemoteResolveResult = {
    unitItems: HeroMediaItem[];
    globalItems: HeroMediaItem[];
    source: string;
    strategy: "scoped_manifest" | "legacy" | "none";
    channels: {
        global: string;
        unit: string;
    };
};

async function resolveRemoteHeroMedia(variant: HeroMediaVariant, unitSlug?: string | null): Promise<RemoteResolveResult> {
    const normalizedUnitSlug = normalizeHeroUnitSlug(unitSlug) || null;
    const scopedManifestUrl = getScopedManifestUrlForVariant(variant);

    if (scopedManifestUrl) {
        const scopedManifestItems =
            (await withTimeout(getFromManifestUrl(scopedManifestUrl, "global"), HERO_REMOTE_TIMEOUT_MS)) ?? [];
        if (scopedManifestItems.length > 0) {
            const scopedBuckets = resolveScopedHeroMediaItems({
                items: scopedManifestItems,
                unitSlug: normalizedUnitSlug,
                fallbackScope: "global",
            });
            return {
                ...scopedBuckets,
                source: "scoped_manifest",
                strategy: "scoped_manifest",
                channels: {
                    global: "manifest",
                    unit: normalizedUnitSlug ? "manifest" : "not_applicable",
                },
            };
        }
    }

    const globalLegacy = await loadLegacyScopeItems({
        variant,
        unitSlug: normalizedUnitSlug,
        scope: "global",
    });
    const unitLegacy = normalizedUnitSlug
        ? await loadLegacyScopeItems({
            variant,
            unitSlug: normalizedUnitSlug,
            scope: "unit",
        })
        : { items: [] as HeroMediaItem[], channel: "none" as const };

    const legacyBuckets = resolveScopedHeroMediaItems({
        items: composeHeroMediaItems({
            unitSlug: normalizedUnitSlug,
            unitItems: unitLegacy.items,
            globalItems: globalLegacy.items,
        }),
        unitSlug: normalizedUnitSlug,
        fallbackScope: "global",
    });

    const hasRemoteItems = legacyBuckets.globalItems.length > 0 || legacyBuckets.unitItems.length > 0;

    return {
        ...legacyBuckets,
        source: `legacy_global_${globalLegacy.channel}_unit_${normalizedUnitSlug ? unitLegacy.channel : "not_applicable"}`,
        strategy: hasRemoteItems ? "legacy" : "none",
        channels: {
            global: globalLegacy.channel,
            unit: normalizedUnitSlug ? unitLegacy.channel : "not_applicable",
        },
    };
}

async function refreshHeroMedia(variant: HeroMediaVariant, unitSlug?: string | null): Promise<void> {
    const cacheKey = getHeroCacheKey(variant, unitSlug);
    const inFlight = refreshInFlightByKey[cacheKey];
    if (inFlight) return inFlight;

    const refreshPromise: Promise<void> = (async () => {
        const localScoped = getLocalHeroItemsByScope(variant, { unitSlug });
        const remoteScoped = await resolveRemoteHeroMedia(variant, unitSlug);
        const items = composeHeroMediaItems({
            unitSlug,
            unitItems: [...remoteScoped.unitItems, ...localScoped.unitItems],
            globalItems: [...remoteScoped.globalItems, ...localScoped.globalItems],
        });

        const finalScoped = resolveScopedHeroMediaItems({
            items,
            unitSlug,
            fallbackScope: "global",
        });

        const source = remoteScoped.strategy === "none" ? "local_only" : `local_plus_${remoteScoped.source}`;
        const debug: HeroCacheDebug = {
            source,
            count: items.length,
            scopeCounts: {
                global: finalScoped.globalItems.length,
                unit: finalScoped.unitItems.length,
            },
            sourceCounts: {
                local: {
                    global: localScoped.globalItems.length,
                    unit: localScoped.unitItems.length,
                    total: localScoped.globalItems.length + localScoped.unitItems.length,
                },
                remote: {
                    global: remoteScoped.globalItems.length,
                    unit: remoteScoped.unitItems.length,
                    total: remoteScoped.globalItems.length + remoteScoped.unitItems.length,
                },
            },
            remoteStrategy: remoteScoped.strategy,
            remoteChannels: remoteScoped.channels,
        };

        heroCacheByKey[cacheKey] = {
            items,
            source,
            debug,
            expiresAtMs: Date.now() + HERO_CACHE_TTL_MS,
        };
    })()
        .catch(() => {
            // ignore refresh errors
        })
        .finally(() => {
            delete refreshInFlightByKey[cacheKey];
        });
    refreshInFlightByKey[cacheKey] = refreshPromise;
    return refreshPromise;
}

export async function getHeroMediaItems(
    options: { variant?: HeroMediaVariant; unitSlug?: string | null } = {},
): Promise<{ items: HeroMediaItem[]; source: string; debug: HeroCacheDebug }> {
    const variant = options.variant ?? "desktop";
    const unitSlug = options.unitSlug ?? null;
    const cacheKey = getHeroCacheKey(variant, unitSlug);
    const now = Date.now();
    const existing = heroCacheByKey[cacheKey] ?? null;
    if (existing && existing.expiresAtMs > now) {
        return {
            items: existing.items,
            source: existing.source,
            debug: existing.debug,
        };
    }

    if (existing) {
        void refreshHeroMedia(variant, unitSlug);
        return {
            items: existing.items,
            source: existing.source,
            debug: existing.debug,
        };
    }

    const localScoped = getLocalHeroItemsByScope(variant, { unitSlug });
    const baseItems = composeHeroMediaItems({
        unitSlug,
        unitItems: localScoped.unitItems,
        globalItems: localScoped.globalItems,
    });
    const debug: HeroCacheDebug = {
        source: "local_only",
        count: baseItems.length,
        scopeCounts: {
            global: localScoped.globalItems.length,
            unit: localScoped.unitItems.length,
        },
        sourceCounts: {
            local: {
                global: localScoped.globalItems.length,
                unit: localScoped.unitItems.length,
                total: localScoped.globalItems.length + localScoped.unitItems.length,
            },
            remote: {
                global: 0,
                unit: 0,
                total: 0,
            },
        },
        remoteStrategy: "none",
        remoteChannels: {
            global: "none",
            unit: "none",
        },
    };
    heroCacheByKey[cacheKey] = {
        items: [...baseItems],
        source: "local_only",
        debug,
        expiresAtMs: now + HERO_CACHE_TTL_MS,
    };
    void refreshHeroMedia(variant, unitSlug);
    return { items: baseItems, source: "local_only", debug };
}
