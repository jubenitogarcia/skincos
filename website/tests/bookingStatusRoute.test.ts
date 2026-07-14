import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { readBookingStatusAuth } from "../src/app/api/booking/status/auth";

test("booking status auth accepts token via dedicated header", () => {
    const req = new NextRequest("https://example.com/api/booking/status?id=req_123", {
        headers: { "x-booking-status-token": "signed-token" },
    });

    assert.deepEqual(readBookingStatusAuth(req), {
        ok: true,
        id: "req_123",
        token: "signed-token",
    });
});

test("booking status auth accepts bearer token without exposing it in the URL", () => {
    const req = new NextRequest("https://example.com/api/booking/status?id=req_123", {
        headers: { authorization: "Bearer signed-token" },
    });

    assert.deepEqual(readBookingStatusAuth(req), {
        ok: true,
        id: "req_123",
        token: "signed-token",
    });
});

test("booking status auth rejects token in query string", () => {
    const req = new NextRequest("https://example.com/api/booking/status?id=req_123&token=leaked");

    assert.deepEqual(readBookingStatusAuth(req), {
        ok: false,
        status: 400,
        error: "token_in_query_forbidden",
    });
});
