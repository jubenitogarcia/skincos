import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION,
    readRodaDaBelezaPublicCampaignV1,
} from "../src/lib/publicCampaigns/rodaDaBelezaV1";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "../src/app/api/public/campaigns/roda-da-beleza/v1/route";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

function assertPrivateNoStore(response: Response) {
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate, private");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
}

test("the public Roda da Beleza contract has no default commercial campaign", () => {
    assert.equal(readRodaDaBelezaPublicCampaignV1(), null);
});

test("the public campaign endpoint fails closed regardless of caller input", async () => {
    const request = new Request(
        "https://example.com/api/public/campaigns/roda-da-beleza/v1?campaign=legacy&email=test%40example.com",
        {
            headers: {
                cookie: "ef_cadastro_lead=legacy-lead; ef_cadastro_wheel=legacy-prize",
                origin: "https://untrusted.example",
            },
        },
    );

    const response = GET(request);
    assert.equal(response.status, 503);
    assertPrivateNoStore(response);
    assert.deepEqual(await response.json(), {
        ok: false,
        contractVersion: RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION,
        error: "campaign_unavailable",
    });
});

test("the public campaign endpoint exposes only safe read semantics", () => {
    const request = new Request("https://example.com/api/public/campaigns/roda-da-beleza/v1");

    const head = HEAD(request);
    assert.equal(head.status, 503);
    assertPrivateNoStore(head);

    const options = OPTIONS(request);
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS");
    assertPrivateNoStore(options);

    for (const handler of [POST, PUT, PATCH, DELETE]) {
        const response = handler(request);
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
        assertPrivateNoStore(response);
    }
});

test("the new public surface remains isolated from legacy, data, and runtime dependencies", async () => {
    const [contract, route] = await Promise.all([
        readFile(sourceUrl("src/lib/publicCampaigns/rodaDaBelezaV1.ts"), "utf8"),
        readFile(sourceUrl("src/app/api/public/campaigns/roda-da-beleza/v1/route.ts"), "utf8"),
    ]);
    const source = `${contract}\n${route}`;

    for (const forbidden of [
        "cadastroLeadDb",
        "cadastroWheel",
        "bookingDb",
        "getCloudflareContext",
        "getRuntimeSecret",
        "process.env",
        "fetch(",
        "cookies.",
    ]) {
        assert.equal(source.includes(forbidden), false, `public campaign foundation must not reference ${forbidden}`);
    }
});
