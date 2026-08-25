import assert from "node:assert/strict";
import test from "node:test";
import { parseD1UpdateResponse } from "../scripts/beauty-movement-update-copy-json";

test("parses a clean Wrangler D1 JSON response", () => {
    const response = [{ success: true, meta: { duration: 1 } }];
    assert.deepEqual(parseD1UpdateResponse(JSON.stringify(response)), response);
});

test("parses JSON after Wrangler/npm output and ANSI formatting", () => {
    const response = [{ success: true, meta: { duration: 1 } }];
    const output = `\u001b[33mwarning before payload\u001b[0m\n${JSON.stringify(response, null, 2)}\ntrailing log`;
    assert.deepEqual(parseD1UpdateResponse(output), response);
});

test("rejects output without a complete JSON object or array", () => {
    assert.throws(
        () => parseD1UpdateResponse("Wrangler failed before producing a JSON response"),
        /beauty_movement_campaign_copy_update_response_invalid/,
    );
});
