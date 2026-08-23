import assert from "node:assert/strict";
import test from "node:test";
import {
    prepareBeautyMovementShortLinks,
    renderBeautyMovementShortLinkConflictSql,
    renderBeautyMovementShortLinkSql,
    serializeBeautyMovementShortLinkCsv,
} from "../src/lib/beautyMovementShortLinks";

const row = (token: string, name = "Ana Silva") => ({
    name,
    inviteRef: `invite-${token.slice(-5)}`,
    whatsapp: "+5551999991234",
    inviteUrl: `https://espacofacial.com/BelezaEmMovimento#c=${token}`,
});

test("short links use the final five token characters and preserve the canonical destination", () => {
    const plan = prepareBeautyMovementShortLinks({
        rows: [row("abcdefghijklmnopqrstuvwxyzABCDEFGHijklmno123")],
        campaignId: "beauty-movement-test-1",
        createdAtMs: 1700000000000,
    });
    assert.equal(plan.links[0]?.shortUrl, "https://esfa.co/no123/BelezaEmMovimento");
    assert.equal(plan.links[0]?.normalizedSlugPath, "/no123/belezaemmovimento");
    assert.equal(plan.links[0]?.destinationUrl, "https://espacofacial.com/BelezaEmMovimento#c=abcdefghijklmnopqrstuvwxyzABCDEFGHijklmno123");
    assert.equal(plan.links[0]?.source, "beauty_movement_short_links_v1");
    assert.match(plan.links[0]?.id ?? "", /^beauty-movement-short-v3-[a-z0-9-]+-[0-9a-f]{32}$/);
    const sql = renderBeautyMovementShortLinkSql(plan);
    assert.match(sql, /ON CONFLICT\(site_host, slug_path\) DO NOTHING/);
    assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT|SAVEPOINT)\b/i);
    const conflictSql = renderBeautyMovementShortLinkConflictSql(plan);
    assert.match(conflictSql, /WHERE site_host = 'esfa\.co' AND slug_path IN/);
    assert.equal(conflictSql.includes("id IN"), false);
});

test("short-link suffix collisions are detected case-insensitively", () => {
    assert.throws(
        () => prepareBeautyMovementShortLinks({ rows: [row("a".repeat(35) + "O1aBc"), row("b".repeat(35) + "o1AbC")], campaignId: "beauty-movement-test-2" }),
        /suffix_collision/,
    );
});

test("delivery export contains no canonical token after shortening", () => {
    const plan = prepareBeautyMovementShortLinks({ rows: [row("abcdefghijklmnopqrstuvwxyzABCDEFGHijklmno123")], campaignId: "beauty-movement-test-3" });
    const csv = serializeBeautyMovementShortLinkCsv(plan);
    assert.match(csv, /https:\/\/esfa\.co\/no123\/BelezaEmMovimento/);
    assert.equal(csv.includes("#c="), false);
});

test("short-link preparation upgrades the legacy lowercase delivery path", () => {
    const legacy = row("abcdefghijklmnopqrstuvwxyzABCDEFGHijklmno123");
    legacy.inviteUrl = legacy.inviteUrl.replace("/BelezaEmMovimento", "/beleza-em-movimento");
    const plan = prepareBeautyMovementShortLinks({ rows: [legacy], campaignId: "beauty-movement-test-4" });
    assert.equal(plan.links[0]?.destinationUrl.startsWith("https://espacofacial.com/BelezaEmMovimento#c="), true);
});
