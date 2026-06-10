import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contentSecurityPolicySource = readFileSync(new URL("../contentSecurityPolicy.mjs", import.meta.url), "utf8");

function directiveValue(name: string): string {
    const directive = contentSecurityPolicySource.match(new RegExp(`"${name} ([^"]+)"`));
    assert.ok(directive?.[1], `${name} directive should exist`);
    return directive[1];
}

test("content security policy allows Cloudflare Insights script and beacon endpoints", () => {
    assert.match(directiveValue("script-src"), /https:\/\/static\.cloudflareinsights\.com/);
    assert.match(directiveValue("connect-src"), /https:\/\/cloudflareinsights\.com/);
    assert.match(directiveValue("connect-src"), /https:\/\/\*\.cloudflareinsights\.com/);
});
