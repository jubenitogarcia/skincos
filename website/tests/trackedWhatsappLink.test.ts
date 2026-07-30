import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tracked WhatsApp contact uses a native anchor for exactly one redirect request", async () => {
    const source = await readFile(
        new URL("../src/components/TrackedWhatsappLink.tsx", import.meta.url),
        "utf8",
    );

    assert.equal(source.includes('from "next/link"'), false);
    assert.equal(source.includes("<a"), true);
    assert.equal(source.includes("window.location.assign(href)"), true);
});
