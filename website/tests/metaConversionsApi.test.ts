import assert from "node:assert/strict";
import test from "node:test";
import type { TrackingContext } from "../src/lib/attribution";
import { META_SCHEDULE_CONTENT_TYPE } from "../src/lib/metaEventContracts";
import {
    sendMetaServerEvent,
    type MetaServerEvent,
} from "../src/lib/metaConversionsApi";

type CapturedMetaEvent = {
    event_name?: string;
    event_id?: string;
    action_source?: string;
    custom_data?: Record<string, unknown>;
    user_data: {
        em?: string[];
        ph?: string[];
        external_id?: string[];
        fbp?: string;
        fbc?: string;
    };
};

function acceptedTrackingContext(): TrackingContext {
    return {
        capturedAtMs: 1_712_345_678_000,
        pageUrl: "https://espacofacial.com/agendamento?fbclid=test-fbclid",
        pagePath: "/agendamento?fbclid=test-fbclid",
        referrer: null,
        consent: { analytics: true, marketing: true },
        params: { fbclid: "test-fbclid" },
        fbclid: "test-fbclid",
        fbp: "fb.1.1712345678.browser",
        fbc: "fb.1.1712345678.test-fbclid",
        landingUrl: "https://espacofacial.com/agendamento?fbclid=test-fbclid",
        landingPath: "/agendamento?fbclid=test-fbclid",
        firstTouch: null,
        lastTouch: null,
    };
}

function scheduleEvent(overrides: Partial<MetaServerEvent> = {}): MetaServerEvent {
    return {
        eventName: "Schedule",
        eventId: "schedule_test_event",
        eventTime: 1_712_345_678,
        eventSourceUrl: "https://espacofacial.com/agendamento?fbclid=test-fbclid",
        userData: {
            email: "teste.capi@example.invalid",
            phone: "+55 (51) 99999-0000",
            externalId: "synthetic-customer-123",
            clientIpAddress: "203.0.113.5",
            clientUserAgent: "MetaCapiUnitTest/1.0",
            fbp: "fb.1.1712345678.browser",
            fbc: "fb.1.1712345678.test-fbclid",
        },
        customData: {
            content_type: META_SCHEDULE_CONTENT_TYPE,
            currency: "BRL",
        },
        trackingContext: acceptedTrackingContext(),
        bookingId: "synthetic-booking-123",
        ...overrides,
    };
}

function setTestSecrets(): () => void {
    const previous = {
        pixelId: process.env.META_PIXEL_ID,
        accessToken: process.env.META_ACCESS_TOKEN,
        apiVersion: process.env.META_API_VERSION,
        testEventCode: process.env.META_CAPI_TEST_EVENT_CODE,
    };
    process.env.META_PIXEL_ID = "1055784516710042";
    process.env.META_ACCESS_TOKEN = "test-access-token";
    process.env.META_API_VERSION = "v22.0";
    delete process.env.META_CAPI_TEST_EVENT_CODE;

    return () => {
        if (previous.pixelId === undefined) delete process.env.META_PIXEL_ID;
        else process.env.META_PIXEL_ID = previous.pixelId;
        if (previous.accessToken === undefined) delete process.env.META_ACCESS_TOKEN;
        else process.env.META_ACCESS_TOKEN = previous.accessToken;
        if (previous.apiVersion === undefined) delete process.env.META_API_VERSION;
        else process.env.META_API_VERSION = previous.apiVersion;
        if (previous.testEventCode === undefined) delete process.env.META_CAPI_TEST_EVENT_CODE;
        else process.env.META_CAPI_TEST_EVENT_CODE = previous.testEventCode;
    };
}

test("CAPI is fail-closed when marketing consent is absent or refused", async () => {
    const restoreSecrets = setTestSecrets();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    const deliveries: Array<{ errorMessage: string | null; endpoint: string }> = [];

    globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response("unexpected CAPI request", { status: 500 });
    }) as typeof fetch;

    try {
        for (const trackingContext of [null, { ...acceptedTrackingContext(), consent: { analytics: true, marketing: false } }]) {
            const result = await sendMetaServerEvent(
                scheduleEvent({ trackingContext }),
                {
                    logDelivery: async (entry) => {
                        deliveries.push({ errorMessage: entry.errorMessage, endpoint: entry.endpoint });
                    },
                },
            );
            assert.deepEqual(result, { ok: false, skipped: "marketing_consent_denied" });
        }

        assert.equal(fetchCalls, 0);
        assert.deepEqual(deliveries, [
            { errorMessage: "marketing_consent_denied", endpoint: "meta_capi_not_sent_without_marketing_consent" },
            { errorMessage: "marketing_consent_denied", endpoint: "meta_capi_not_sent_without_marketing_consent" },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        restoreSecrets();
    }
});

test("accepted Schedule keeps booking content type and hashes identifiers before CAPI delivery", async () => {
    const restoreSecrets = setTestSecrets();
    const originalFetch = globalThis.fetch;
    let capturedPayload: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input, init) => {
        capturedPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response('{"events_received":1}', { status: 200 });
    }) as typeof fetch;

    try {
        const result = await sendMetaServerEvent(scheduleEvent());
        assert.equal(result.ok, true);
        const payload = capturedPayload as Record<string, unknown> | null;
        assert.ok(payload);

        const event = (payload.data as CapturedMetaEvent[])[0];
        assert.equal(event.event_name, "Schedule");
        assert.equal(event.event_id, "schedule_test_event");
        assert.equal(event.action_source, "website");
        assert.deepEqual(event.custom_data, {
            content_type: "booking",
            currency: "BRL",
        });
        assert.equal(event.user_data.em?.[0], "9e2cd5cb82deac7da5447b32f731280f35152638f0a40312a90abf75f679fcec");
        assert.equal(event.user_data.ph?.[0], "e3acfc6021fc199bc664eda07074646e0c3505abee84dca49b011db7be878f1b");
        assert.equal(event.user_data.external_id?.[0], "b337b68d7c27dd68a6b3ff3056c30489871e232f6ebd54439b7e305a97902062");
        assert.equal(event.user_data.fbp, "fb.1.1712345678.browser");
        assert.equal(event.user_data.fbc, "fb.1.1712345678.test-fbclid");
    } finally {
        globalThis.fetch = originalFetch;
        restoreSecrets();
    }
});

test("Contact without custom data omits custom_data from the CAPI payload", async () => {
    const restoreSecrets = setTestSecrets();
    const originalFetch = globalThis.fetch;
    let capturedPayload: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input, init) => {
        capturedPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response('{"events_received":1}', { status: 200 });
    }) as typeof fetch;

    try {
        const result = await sendMetaServerEvent({
            eventName: "Contact",
            eventId: "contact_test_event",
            eventTime: 1_712_345_678,
            eventSourceUrl: "https://espacofacial.com/contato?fbclid=test-fbclid",
            userData: {
                clientIpAddress: "203.0.113.5",
                clientUserAgent: "MetaCapiUnitTest/1.0",
                fbp: "fb.1.1712345678.browser",
                fbc: "fb.1.1712345678.test-fbclid",
            },
            trackingContext: acceptedTrackingContext(),
        });

        assert.equal(result.ok, true);
        const payload = capturedPayload as Record<string, unknown> | null;
        assert.ok(payload);

        const event = (payload.data as CapturedMetaEvent[])[0];
        assert.equal(event.event_name, "Contact");
        assert.equal(event.event_id, "contact_test_event");
        assert.equal(Object.hasOwn(event, "custom_data"), false);
    } finally {
        globalThis.fetch = originalFetch;
        restoreSecrets();
    }
});

test("CAPI delivery remains successful when audit logging is unavailable", async () => {
    const restoreSecrets = setTestSecrets();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('{"events_received":1}', { status: 200 });
    }) as typeof fetch;

    try {
        const result = await sendMetaServerEvent(scheduleEvent(), {
            logDelivery: async () => {
                throw new Error("synthetic D1 audit failure");
            },
        });

        assert.equal(result.ok, true);
        assert.equal(fetchCalls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        restoreSecrets();
    }
});
