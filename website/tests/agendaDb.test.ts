import assert from "node:assert/strict";
import test from "node:test";
import { parseDateKey, parseTimeKey } from "../src/lib/agendaDb";

test("parseDateKey returns yyyy-mm-dd", () => {
    assert.equal(parseDateKey("03/03/2026"), "2026-03-03");
    assert.equal(parseDateKey("31/12/2026"), "2026-12-31");
});

test("parseDateKey rejects invalid", () => {
    assert.equal(parseDateKey("2026-03-03"), "");
    assert.equal(parseDateKey("03/03/26"), "");
});

test("parseTimeKey returns hh:mm", () => {
    assert.equal(parseTimeKey("09:00"), "09:00");
    assert.equal(parseTimeKey("18:30"), "18:30");
});

test("parseTimeKey rejects invalid", () => {
    assert.equal(parseTimeKey("9:00"), "");
    assert.equal(parseTimeKey("25:00"), "");
});
