import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

const LEGACY_WHEEL_PATHS = ["/roleta", "/roda-da-beleza", "/rodadabeleza"];

function redirectFor(requestUrl: string) {
    const response = middleware(new NextRequest(requestUrl));
    const location = response.headers.get("location");

    assert.ok(location, `${requestUrl} should include a redirect location`);
    return { response, destination: new URL(location, requestUrl) };
}

test("legacy Roda da Beleza paths redirect to cadastro without losing campaign parameters", () => {
    for (const path of LEGACY_WHEEL_PATHS) {
        const source = new URL(path, "https://espacofacial.com");
        source.searchParams.append("utm_source", "meta");
        source.searchParams.append("utm_campaign", "roda-da-beleza");
        source.searchParams.append("tag", "first");
        source.searchParams.append("tag", "second");

        const { response, destination } = redirectFor(source.toString());

        assert.equal(response.status, 301);
        assert.equal(destination.origin, source.origin);
        assert.equal(destination.pathname, "/cadastro");
        assert.deepEqual([...destination.searchParams.entries()], [...source.searchParams.entries()]);
    }
});

test("legacy Roda da Beleza paths stay on the staging worker host", () => {
    const source = new URL(
        "/roda-da-beleza?utm_source=staging&utm_campaign=roda-da-beleza",
        "https://espacofacial-site-staging.skincos.workers.dev",
    );

    const { response, destination } = redirectFor(source.toString());

    assert.equal(response.status, 301);
    assert.equal(destination.origin, source.origin);
    assert.equal(destination.pathname, "/cadastro");
    assert.equal(destination.search, source.search);
});

test("legacy Roda da Beleza paths recognize a public host header with a local port", () => {
    const requestUrl = "http://127.0.0.1:3417/roleta?utm_source=local";
    const response = middleware(
        new NextRequest(requestUrl, {
            headers: { host: "espacofacial.com:3417" },
        }),
    );
    const location = response.headers.get("location");

    assert.ok(location, "the public host header should enable the legacy redirect");
    assert.equal(response.status, 301);
    assert.equal(new URL(location, requestUrl).pathname, "/cadastro");
    assert.equal(new URL(location, requestUrl).searchParams.get("utm_source"), "local");
});

test("legacy Roda da Beleza paths do not take over the esfa.co short-link domain", () => {
    const response = middleware(new NextRequest("https://esfa.co/roleta?utm_source=meta"));

    assert.equal(response.headers.get("location"), null);
});
