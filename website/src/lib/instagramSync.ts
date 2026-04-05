import { fetchActiveInjectors } from "@/lib/injectorsDirectory";
import {
    getInstagramCachedProfile,
    getInstagramCachedProfileStats,
    insertInstagramSyncRun,
    listInstagramCachedMedia,
    markInstagramSyncAttempt,
    newInstagramSyncRunId,
    pruneInstagramCache,
    upsertInstagramCachedProfile,
    upsertInstagramCachedProfileStats,
    upsertInstagramMediaBatch,
} from "@/lib/instagramCacheDb";

const INSTAGRAM_APP_ID = "936619743392459";
const FEED_PAGE_SIZE = 24;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const MAX_FEED_PAGES = 4;

export const INSTAGRAM_SYNC_TTL_MS = 30 * 60 * 1000;
export const INSTAGRAM_KEEP_POSTS_PER_HANDLE = 180;
export const INSTAGRAM_STORIES_RETENTION_MS = 72 * 60 * 60 * 1000;

export type InstagramApiUser = {
    id: string;
    handle: string;
    name: string | null;
    bio: string | null;
    followersCount?: number | null;
    followingCount?: number | null;
    mediaCount?: number | null;
};

export type InstagramApiMedia = {
    id: string;
    code: string | null;
    mediaType: "image" | "video" | "carousel";
    isReel: boolean;
    isStory: boolean;
    caption: string | null;
    takenAtMs: number | null;
    thumbnailUrl: string;
    videoUrl: string | null;
    permalink: string | null;
};

export type InstagramFeedPage = {
    ok: true;
    user: InstagramApiUser;
    items: InstagramApiMedia[];
    hasMore: boolean;
    nextCursor: string | null;
};

type InstagramProfileResponse = {
    data?: {
        user?: {
            id?: string;
            username?: string;
            full_name?: string;
            biography?: string;
            profile_pic_url_hd?: string;
            profile_pic_url?: string;
            follower_count?: number;
            following_count?: number;
            media_count?: number;
            edge_followed_by?: { count?: number };
            edge_follow?: { count?: number };
            edge_owner_to_timeline_media?: { count?: number };
        };
    };
};

type InstagramProfileUser = NonNullable<InstagramProfileResponse["data"]>["user"];

type InstagramFeedImageCandidate = {
    url?: string;
    width?: number;
    height?: number;
};

type InstagramFeedVideoVersion = {
    url?: string;
    width?: number;
    height?: number;
};

type InstagramFeedItem = {
    id?: string;
    pk?: string;
    code?: string;
    media_type?: number;
    product_type?: string;
    taken_at?: number;
    caption?: { text?: string | null } | null;
    image_versions2?: { candidates?: InstagramFeedImageCandidate[] } | null;
    video_versions?: InstagramFeedVideoVersion[] | null;
    carousel_media?: InstagramFeedItem[] | null;
};

type InstagramFeedResponse = {
    items?: InstagramFeedItem[];
    more_available?: boolean;
    next_max_id?: string | null;
};

type InstagramStoriesResponse = {
    reels?: Record<string, { items?: InstagramFeedItem[] }>;
};

export type SyncHandleResult = {
    handle: string;
    ok: boolean;
    userId: string | null;
    fetchedItems: number;
    fetchedStories: number;
    upsertedItems: number;
    error: string | null;
};

function sanitizeHandle(input: string): string {
    return (input ?? "")
        .trim()
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9._]/g, "")
        .toLowerCase();
}

function sanitizeUserId(input: string): string {
    return (input ?? "").trim().replace(/[^0-9]/g, "");
}

function normalizeCount(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const out = Math.max(0, Math.floor(n));
    return out;
}

function extractProfileStats(profile: InstagramProfileUser | null): {
    followersCount: number | null;
    followingCount: number | null;
    mediaCount: number | null;
} {
    if (!profile) {
        return {
            followersCount: null,
            followingCount: null,
            mediaCount: null,
        };
    }

    return {
        followersCount: normalizeCount(profile.follower_count ?? profile.edge_followed_by?.count),
        followingCount: normalizeCount(profile.following_count ?? profile.edge_follow?.count),
        mediaCount: normalizeCount(profile.media_count ?? profile.edge_owner_to_timeline_media?.count),
    };
}

function parseCursorOffset(cursor: string | null | undefined): number {
    const raw = (cursor ?? "").trim();
    if (!raw) return 0;
    const match = /^(?:o:)?([0-9]+)$/.exec(raw);
    if (!match) return 0;
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
}

function buildCursorOffset(offset: number): string {
    return `o:${Math.max(0, Math.floor(offset))}`;
}

function instagramRequestHeaders(): HeadersInit {
    return {
        "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "x-ig-app-id": INSTAGRAM_APP_ID,
        origin: "https://www.instagram.com",
        referer: "https://www.instagram.com/",
    };
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

async function fetchInstagramJson<T>(url: string): Promise<T | null> {
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                redirect: "follow",
                headers: instagramRequestHeaders(),
                next: { revalidate: 60 * 5 },
            });

            if (!res.ok) {
                if (attempt < MAX_FETCH_ATTEMPTS - 1 && isRetryableStatus(res.status)) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                    continue;
                }
                return null;
            }

            const raw = await res.text();
            const cleaned = raw.replace(/^for \(;;\);\s*/, "");
            try {
                return JSON.parse(cleaned) as T;
            } catch {
                if (attempt < MAX_FETCH_ATTEMPTS - 1) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                    continue;
                }
                return null;
            }
        } catch {
            if (attempt < MAX_FETCH_ATTEMPTS - 1) {
                await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                continue;
            }
            return null;
        }
    }

    return null;
}

async function fetchProfile(handle: string): Promise<InstagramProfileUser | null> {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
    const json = await fetchInstagramJson<InstagramProfileResponse>(url);
    return json?.data?.user ?? null;
}

async function fetchFeedPage(params: { userId: string; cursor?: string | null; count?: number }): Promise<InstagramFeedResponse | null> {
    const url = new URL(`https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(params.userId)}/`);
    url.searchParams.set("count", String(params.count ?? FEED_PAGE_SIZE));
    if (params.cursor) url.searchParams.set("max_id", params.cursor);
    return fetchInstagramJson<InstagramFeedResponse>(url.toString());
}

async function fetchStoryItems(userId: string): Promise<InstagramFeedItem[]> {
    const url = new URL("https://www.instagram.com/api/v1/feed/reels_media/");
    url.searchParams.set("reel_ids", userId);

    const json = await fetchInstagramJson<InstagramStoriesResponse>(url.toString());
    const reels = json?.reels;
    if (!reels || typeof reels !== "object") return [];

    const direct = reels[userId];
    if (direct && Array.isArray(direct.items)) return direct.items;

    for (const value of Object.values(reels)) {
        if (value && Array.isArray(value.items)) return value.items;
    }

    return [];
}

function pickLargestImage(candidates: InstagramFeedImageCandidate[] | null | undefined): string | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => {
        const areaA = (a.width ?? 0) * (a.height ?? 0);
        const areaB = (b.width ?? 0) * (b.height ?? 0);
        return areaB - areaA;
    });
    const best = sorted[0];
    return typeof best?.url === "string" ? best.url : null;
}

function pickLargestVideo(versions: InstagramFeedVideoVersion[] | null | undefined): string | null {
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const sorted = [...versions].sort((a, b) => {
        const areaA = (a.width ?? 0) * (a.height ?? 0);
        const areaB = (b.width ?? 0) * (b.height ?? 0);
        return areaB - areaA;
    });
    const best = sorted[0];
    return typeof best?.url === "string" ? best.url : null;
}

function normalizeItem(params: {
    item: InstagramFeedItem;
    handle: string;
    isStory: boolean;
}): InstagramApiMedia | null {
    const { item, handle, isStory } = params;

    const code = typeof item.code === "string" && item.code.trim() ? item.code.trim() : null;
    const mediaId = `${item.id ?? item.pk ?? code ?? ""}`.trim();
    if (!mediaId) return null;

    const mediaTypeNumber = item.media_type ?? 1;
    const isCarousel = mediaTypeNumber === 8;
    const isVideo = mediaTypeNumber === 2;

    let imageUrl = pickLargestImage(item.image_versions2?.candidates);
    let videoUrl = pickLargestVideo(item.video_versions);

    if (isCarousel && Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
        const first = item.carousel_media[0];
        imageUrl = imageUrl ?? pickLargestImage(first?.image_versions2?.candidates);
        if (!videoUrl) videoUrl = pickLargestVideo(first?.video_versions);
    }

    if (!imageUrl && !videoUrl) return null;

    const isReel = item.product_type === "clips";
    const permalink = (() => {
        if (isStory) {
            const storyPk = `${item.pk ?? item.id ?? ""}`.trim();
            return storyPk ? `https://www.instagram.com/stories/${handle}/${storyPk}/` : null;
        }
        if (!code) return null;
        return isReel ? `https://www.instagram.com/reel/${code}/` : `https://www.instagram.com/p/${code}/`;
    })();

    return {
        id: `${handle}:${isStory ? "story:" : ""}${mediaId}`,
        code,
        mediaType: isCarousel ? "carousel" : isVideo ? "video" : "image",
        isReel,
        isStory,
        caption: typeof item.caption?.text === "string" && item.caption.text.trim() ? item.caption.text.trim() : null,
        takenAtMs: typeof item.taken_at === "number" ? item.taken_at * 1000 : null,
        thumbnailUrl: imageUrl ?? videoUrl ?? "",
        videoUrl: videoUrl ?? null,
        permalink,
    };
}

async function fetchFeedItems(userId: string, maxItems: number): Promise<InstagramFeedItem[]> {
    const items: InstagramFeedItem[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_FEED_PAGES; page++) {
        if (items.length >= maxItems) break;

        const pageSize = Math.max(1, Math.min(FEED_PAGE_SIZE, maxItems - items.length));
        const feed = await fetchFeedPage({ userId, cursor, count: pageSize });
        if (!feed) break;

        const nextItems = Array.isArray(feed.items) ? feed.items : [];
        if (nextItems.length === 0) break;
        items.push(...nextItems);

        const nextCursor = typeof feed.next_max_id === "string" && feed.next_max_id.trim() ? feed.next_max_id : null;
        if (!feed.more_available || !nextCursor) break;
        cursor = nextCursor;
    }

    return items.slice(0, maxItems);
}

export async function isInstagramProfileStale(handleRaw: string, maxAgeMs = INSTAGRAM_SYNC_TTL_MS): Promise<boolean> {
    const handle = sanitizeHandle(handleRaw);
    if (!handle) return true;

    const profile = await getInstagramCachedProfile(handle);
    if (!profile) return true;

    const now = Date.now();
    return profile.last_success_sync_ms <= 0 || now - profile.last_success_sync_ms > maxAgeMs;
}

export async function getCachedInstagramFeed(params: {
    handle: string;
    cursor?: string | null;
    count: number;
    includeStories?: boolean;
}): Promise<InstagramFeedPage | null> {
    const handle = sanitizeHandle(params.handle);
    if (!handle) return null;

    const offset = parseCursorOffset(params.cursor);
    const pageSize = Math.max(1, Math.min(24, params.count));
    const includeStories = params.includeStories ?? true;

    const profile = await getInstagramCachedProfile(handle);
    const stats = await getInstagramCachedProfileStats(handle);
    const rows = await listInstagramCachedMedia({
        handle,
        includeStories,
        limit: pageSize + 1,
        offset,
    });

    if (!rows.length) return null;

    const hasMore = rows.length > pageSize;
    const windowRows = hasMore ? rows.slice(0, pageSize) : rows;

    const items: InstagramApiMedia[] = windowRows
        .map((row) => {
            const mediaType = row.media_type === "video" || row.media_type === "carousel" ? row.media_type : "image";
            const thumbnailUrl = (row.thumbnail_url ?? "").trim();
            if (!thumbnailUrl) return null;

            return {
                id: row.id,
                code: row.code,
                mediaType,
                isReel: row.is_reel === 1,
                isStory: row.is_story === 1,
                caption: row.caption,
                takenAtMs: row.taken_at_ms,
                thumbnailUrl,
                videoUrl: row.video_url,
                permalink: row.permalink,
            } satisfies InstagramApiMedia;
        })
        .filter((item): item is InstagramApiMedia => !!item);

    if (!items.length) return null;

    const userId = sanitizeUserId(profile?.user_id ?? "");
    return {
        ok: true,
        user: {
            id: userId,
            handle,
            name: profile?.full_name ?? null,
            bio: profile?.biography ?? null,
            followersCount: stats?.followers_count ?? null,
            followingCount: stats?.following_count ?? null,
            mediaCount: stats?.media_count ?? null,
        },
        items,
        hasMore,
        nextCursor: hasMore ? buildCursorOffset(offset + pageSize) : null,
    };
}

export async function fetchLiveInstagramFeedPage(params: {
    handle: string;
    cursor?: string | null;
    count: number;
    includeStories?: boolean;
}): Promise<InstagramFeedPage | null> {
    const handle = sanitizeHandle(params.handle);
    if (!handle) return null;

    const profile = await fetchProfile(handle);
    const userId = sanitizeUserId(profile?.id ?? "");
    if (!userId) return null;
    const stats = extractProfileStats(profile);

    const feed = await fetchFeedPage({
        userId,
        cursor: (params.cursor ?? "").trim() || null,
        count: Math.max(1, Math.min(24, params.count)),
    });
    if (!feed) return null;

    const feedItems = (Array.isArray(feed.items) ? feed.items : [])
        .map((item) => normalizeItem({ item, handle, isStory: false }))
        .filter((item): item is InstagramApiMedia => !!item);

    let stories: InstagramApiMedia[] = [];
    const includeStories = params.includeStories ?? true;
    if (includeStories && !(params.cursor ?? "").trim()) {
        const storyItems = await fetchStoryItems(userId);
        stories = storyItems
            .map((item) => normalizeItem({ item, handle, isStory: true }))
            .filter((item): item is InstagramApiMedia => !!item);
    }

    const uniqueById = new Map<string, InstagramApiMedia>();
    for (const item of [...stories, ...feedItems]) uniqueById.set(item.id, item);
    const items = [...uniqueById.values()];

    const nextCursor = typeof feed.next_max_id === "string" && feed.next_max_id.trim() ? feed.next_max_id : null;
    const hasMore = Boolean(feed.more_available && nextCursor);

    return {
        ok: true,
        user: {
            id: userId,
            handle: profile?.username?.trim() || handle,
            name: profile?.full_name?.trim() || null,
            bio: profile?.biography?.trim() || null,
            followersCount: stats.followersCount,
            followingCount: stats.followingCount,
            mediaCount: stats.mediaCount,
        },
        items,
        hasMore,
        nextCursor,
    };
}

export async function syncInstagramHandle(handleRaw: string, opts?: {
    includeStories?: boolean;
    maxFeedItems?: number;
    source?: string;
}): Promise<SyncHandleResult> {
    const handle = sanitizeHandle(handleRaw);
    const startedAtMs = Date.now();
    const runId = newInstagramSyncRunId();

    if (!handle) {
        const out: SyncHandleResult = {
            handle: handleRaw,
            ok: false,
            userId: null,
            fetchedItems: 0,
            fetchedStories: 0,
            upsertedItems: 0,
            error: "invalid_handle",
        };
        await insertInstagramSyncRun({
            id: runId,
            source: opts?.source ?? null,
            handle: handleRaw,
            startedAtMs,
            finishedAtMs: Date.now(),
            success: false,
            fetchedItems: 0,
            fetchedStories: 0,
            upsertedItems: 0,
            error: out.error,
        });
        return out;
    }

    await markInstagramSyncAttempt({ handle, attemptAtMs: startedAtMs, error: null });

    try {
        const profile = await fetchProfile(handle);
        const userId = sanitizeUserId(profile?.id ?? "");
        if (!userId) {
            const error = "profile_not_found";
            await markInstagramSyncAttempt({ handle, attemptAtMs: Date.now(), error });
            await insertInstagramSyncRun({
                id: runId,
                source: opts?.source ?? null,
                handle,
                startedAtMs,
                finishedAtMs: Date.now(),
                success: false,
                fetchedItems: 0,
                fetchedStories: 0,
                upsertedItems: 0,
                error,
            });
            return {
                handle,
                ok: false,
                userId: null,
                fetchedItems: 0,
                fetchedStories: 0,
                upsertedItems: 0,
                error,
            };
        }

        const maxFeedItems = Math.max(FEED_PAGE_SIZE, Math.min(120, opts?.maxFeedItems ?? 54));
        const includeStories = opts?.includeStories ?? true;
        const stats = extractProfileStats(profile);

        const [feedItems, storyItems] = await Promise.all([
            fetchFeedItems(userId, maxFeedItems),
            includeStories ? fetchStoryItems(userId) : Promise.resolve([]),
        ]);

        const normalizedFeed = feedItems
            .map((item) => normalizeItem({ item, handle, isStory: false }))
            .filter((item): item is InstagramApiMedia => !!item);

        const normalizedStories = storyItems
            .map((item) => normalizeItem({ item, handle, isStory: true }))
            .filter((item): item is InstagramApiMedia => !!item);

        const uniqueById = new Map<string, InstagramApiMedia>();
        for (const item of [...normalizedStories, ...normalizedFeed]) {
            uniqueById.set(item.id, item);
        }
        const allItems = [...uniqueById.values()];

        const syncedAtMs = Date.now();
        await upsertInstagramCachedProfile({
            handle,
            userId,
            fullName: profile?.full_name?.trim() || null,
            biography: profile?.biography?.trim() || null,
            avatarUrl: profile?.profile_pic_url_hd ?? profile?.profile_pic_url ?? null,
            lastError: null,
            syncedAtMs,
        });

        await upsertInstagramCachedProfileStats({
            handle,
            followersCount: stats.followersCount,
            followingCount: stats.followingCount,
            mediaCount: stats.mediaCount,
            syncedAtMs,
        });

        const upsertedItems = await upsertInstagramMediaBatch(
            allItems.map((item) => ({
                id: item.id,
                handle,
                mediaId: item.id.replace(`${handle}:`, ""),
                code: item.code,
                mediaType: item.mediaType,
                isReel: item.isReel,
                isStory: item.isStory,
                caption: item.caption,
                takenAtMs: item.takenAtMs,
                thumbnailUrl: item.thumbnailUrl,
                videoUrl: item.videoUrl,
                permalink: item.permalink,
                payloadJson: null,
                updatedAtMs: syncedAtMs,
            })),
        );

        await pruneInstagramCache({
            handle,
            keepPosts: INSTAGRAM_KEEP_POSTS_PER_HANDLE,
            removeStoriesOlderThanMs: syncedAtMs - INSTAGRAM_STORIES_RETENTION_MS,
        });

        await insertInstagramSyncRun({
            id: runId,
            source: opts?.source ?? null,
            handle,
            startedAtMs,
            finishedAtMs: Date.now(),
            success: true,
            fetchedItems: normalizedFeed.length,
            fetchedStories: normalizedStories.length,
            upsertedItems,
            error: null,
        });

        return {
            handle,
            ok: true,
            userId,
            fetchedItems: normalizedFeed.length,
            fetchedStories: normalizedStories.length,
            upsertedItems,
            error: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "sync_exception";
        await markInstagramSyncAttempt({ handle, attemptAtMs: Date.now(), error: message });
        await insertInstagramSyncRun({
            id: runId,
            source: opts?.source ?? null,
            handle,
            startedAtMs,
            finishedAtMs: Date.now(),
            success: false,
            fetchedItems: 0,
            fetchedStories: 0,
            upsertedItems: 0,
            error: message,
        });

        return {
            handle,
            ok: false,
            userId: null,
            fetchedItems: 0,
            fetchedStories: 0,
            upsertedItems: 0,
            error: message,
        };
    }
}

export async function resolveDoctorInstagramHandles(): Promise<string[]> {
    try {
        const members = await fetchActiveInjectors();
        const unique = new Set<string>();
        for (const member of members) {
            const handle = sanitizeHandle(member.instagramHandle ?? "");
            if (handle) unique.add(handle);
        }
        return [...unique.values()].sort();
    } catch {
        return [];
    }
}

export async function syncInstagramHandlesBatch(params: {
    handles: string[];
    includeStories?: boolean;
    maxFeedItems?: number;
    source?: string;
    concurrency?: number;
}): Promise<SyncHandleResult[]> {
    const inputHandles = params.handles.map((h) => sanitizeHandle(h)).filter(Boolean);
    const handles = [...new Set(inputHandles)];
    if (!handles.length) return [];

    const concurrency = Math.max(1, Math.min(8, Math.floor(params.concurrency ?? 3)));
    const queue = [...handles];
    const results: SyncHandleResult[] = [];

    async function worker(): Promise<void> {
        for (; ;) {
            const next = queue.shift();
            if (!next) return;
            const result = await syncInstagramHandle(next, {
                includeStories: params.includeStories,
                maxFeedItems: params.maxFeedItems,
                source: params.source,
            });
            results.push(result);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, handles.length) }, () => worker()));
    return results;
}

export async function getCachedInstagramAvatarUrl(handleRaw: string): Promise<string | null> {
    const handle = sanitizeHandle(handleRaw);
    if (!handle) return null;

    const profile = await getInstagramCachedProfile(handle);
    const url = (profile?.avatar_url ?? "").trim();
    return url || null;
}

export function normalizeInstagramHandleInput(raw: string): string {
    return sanitizeHandle(raw);
}
