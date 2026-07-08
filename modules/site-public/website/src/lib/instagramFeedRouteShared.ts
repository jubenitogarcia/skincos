type CachedInstagramPage = {
    items?: unknown[] | null;
};

export function shouldRefreshInstagramFeed(params: {
    forceRefresh: boolean;
    isFirstPage: boolean;
    stale: boolean;
    page: CachedInstagramPage | null;
}): boolean {
    if (params.forceRefresh) return true;
    if (!params.page) return true;
    if (!params.isFirstPage) return false;
    if (!params.stale) return false;

    // Instagram CDN URLs expire even when cached rows still exist, so stale first-page data
    // must be refreshed before reusing the stored thumbnails/videos.
    return true;
}
