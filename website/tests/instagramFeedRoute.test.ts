import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshInstagramFeed } from "../src/lib/instagramFeedRouteShared";

test("refreshes when the first page cache is stale even if media rows still exist", () => {
    assert.equal(
        shouldRefreshInstagramFeed({
            forceRefresh: false,
            isFirstPage: true,
            stale: true,
            page: { items: [{ id: "cached-item" }] },
        }),
        true,
    );
});

test("does not refresh non-stale cached first page without explicit refresh", () => {
    assert.equal(
        shouldRefreshInstagramFeed({
            forceRefresh: false,
            isFirstPage: true,
            stale: false,
            page: { items: [{ id: "cached-item" }] },
        }),
        false,
    );
});

test("does not refresh later pages just because the profile is stale", () => {
    assert.equal(
        shouldRefreshInstagramFeed({
            forceRefresh: false,
            isFirstPage: false,
            stale: true,
            page: { items: [{ id: "cached-item" }] },
        }),
        false,
    );
});

test("refreshes when the caller explicitly forces a refresh", () => {
    assert.equal(
        shouldRefreshInstagramFeed({
            forceRefresh: true,
            isFirstPage: false,
            stale: false,
            page: { items: [{ id: "cached-item" }] },
        }),
        true,
    );
});

test("refreshes when there is no cached page at all", () => {
    assert.equal(
        shouldRefreshInstagramFeed({
            forceRefresh: false,
            isFirstPage: true,
            stale: false,
            page: null,
        }),
        true,
    );
});
