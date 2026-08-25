import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("campaign routes carry consistent noindex social metadata without changing their canonical route", async () => {
    const pages = await Promise.all([
        readFile(sourceUrl("src/app/beleza-em-movimento/page.tsx"), "utf8"),
        readFile(sourceUrl("src/app/BelezaEmMovimento/page.tsx"), "utf8"),
    ]);

    for (const page of pages) {
        assert.match(page, /canonical: `\$\{siteUrl\}\/BelezaEmMovimento`/);
        assert.match(page, /openGraph:/);
        assert.match(page, /siteName: "Espaço Facial"/);
        assert.match(page, /locale: "pt_BR"/);
        assert.match(page, /twitter:/);
        assert.match(page, /card: "summary"/);
        assert.match(page, /index: false/);
        assert.match(page, /follow: false/);
    }
});
