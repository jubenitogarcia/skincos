import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { TrackingContext } from "../src/lib/attribution";
import type { MetaServerEvent } from "../src/lib/metaConversionsApi";

type FakeStatement = {
    bind: (...values: unknown[]) => FakeStatement;
    first: <T = unknown>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    run: () => Promise<{ success: true }>;
};

const capturedMetaEvents: MetaServerEvent[] = [];
const capturedWhatsappRows: Array<Record<string, unknown>> = [];
const fixedNowMs = Date.parse("2029-01-01T12:00:00Z");
const moduleUrl = (relativePath: string) =>
    new URL(`../src/${relativePath}.ts`, import.meta.url).href;

function fakeStatement(): FakeStatement {
    const statement: FakeStatement = {
        bind: () => statement,
        first: async () => null,
        all: async <T>() => ({ results: [] as T[] }),
        run: async () => ({ success: true }),
    };
    return statement;
}

const fakeDb = {
    prepare: () => fakeStatement(),
    exec: async () => undefined,
};

function sanitizeOneLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function parseCookieHeader(value: string | null): Record<string, string> {
    if (!value) return {};
    return Object.fromEntries(
        value
            .split(";")
            .map((part) => part.trim().split("=", 2))
            .filter(([key, cookieValue]) => Boolean(key && cookieValue)),
    );
}

mock.module(moduleUrl("lib/metaConversionsApi"), {
    namedExports: {
        sendMetaServerEvent: async (event: MetaServerEvent) => {
            capturedMetaEvents.push(event);
            return { ok: true };
        },
    },
});

mock.module(moduleUrl("lib/bookingDb"), {
    namedExports: {
        addMinutes: (value: number, minutes: number) => value + minutes * 60_000,
        clampText: (value: string, maxLength: number) => value.slice(0, maxLength),
        coerceTrackingContext: (value: unknown) => value as TrackingContext | null,
        getBookingDb: async () => fakeDb,
        insertMetaCapiDeliveryLog: async () => undefined,
        insertWhatsappClickEvent: async (_db: unknown, row: Record<string, unknown>) => {
            capturedWhatsappRows.push(row);
        },
        isValidDateKey: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value),
        isValidTimeKey: (value: string) => /^\d{2}:\d{2}$/.test(value),
        normalizeCpf: (value: string) => value.replace(/\D/g, ""),
        normalizeEmail: (value: string) => value.trim().toLowerCase(),
        normalizePhone: (value: string) => value.replace(/\D/g, ""),
        nowMs: () => fixedNowMs,
        parseCookieHeader,
        sanitizeOneLine,
        slugify: (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-"),
        toSaoPauloIso: (date: string, time: string) => `${date}T${time}:00-03:00`,
    },
});

mock.module(moduleUrl("data/services"), {
    namedExports: {
        getServiceById: (id: string) => ({ id, name: "Procedimento sintético" }),
    },
});

mock.module(moduleUrl("lib/injectorsDirectory"), {
    namedExports: {
        getUnitDoctorsResult: async () => ({
            ok: true,
            doctors: [{ slug: "dra-teste", name: "Dra. Teste", instagramHandle: null }],
        }),
    },
});

mock.module(moduleUrl("lib/agendaDb"), {
    namedExports: {
        getAgendaDb: async () => fakeDb,
    },
});

mock.module(moduleUrl("lib/bookingNotifications"), {
    namedExports: {
        sendBookingNotifications: async () => ({
            email: { ok: true, status: "sent", error: null },
            whatsapp: { ok: true, status: "sent", error: null },
            unitEmail: { ok: true, status: "sent", error: null },
        }),
    },
});

mock.module(moduleUrl("lib/doctorSlug"), {
    namedExports: {
        doctorSlugMatchesQuery: () => true,
    },
});

mock.module(moduleUrl("lib/escalaDb"), {
    namedExports: {
        fetchEscalaDaySchedule: async () => null,
        personNameMatches: () => true,
    },
});

mock.module(moduleUrl("lib/bookingSecurity"), {
    namedExports: {
        issueBookingStatusToken: async () => "status-token",
    },
});

mock.module(moduleUrl("lib/runtimeSecrets"), {
    namedExports: {
        getRuntimeSecret: async (name: string) =>
            name === "BOOKING_SYNTHETIC_TEST_TOKEN" ? "synthetic-token" : null,
    },
});

mock.module(moduleUrl("lib/syntheticBookingTest"), {
    namedExports: {
        SYNTHETIC_BOOKING_TEST_TOKEN_HEADER: "x-booking-synthetic-test-token",
        isAuthorizedSyntheticBookingTest: () => true,
    },
});

const [{ POST: postBookingRequest }, { GET: getWhatsappRedirect }] = await Promise.all([
    import("../src/app/api/booking/request/route"),
    import("../src/app/api/whatsapp/redirect/route"),
]);

function acceptedTrackingContext(): TrackingContext {
    return {
        capturedAtMs: fixedNowMs,
        pageUrl: "https://espacofacial.com/agendamento?utm_source=meta&fbclid=route-test",
        pagePath: "/agendamento?utm_source=meta&fbclid=route-test",
        referrer: null,
        consent: { analytics: true, marketing: true },
        params: { utm_source: "meta", fbclid: "route-test" },
        fbclid: "route-test",
        fbp: "fb.1.1860000000.route-browser",
        fbc: "fb.1.1860000000.route-test",
        landingUrl: "https://espacofacial.com/agendamento?utm_source=meta&fbclid=route-test",
        landingPath: "/agendamento?utm_source=meta&fbclid=route-test",
        firstTouch: null,
        lastTouch: null,
    };
}

test("booking request route emits only the approved Schedule custom data", async () => {
    capturedMetaEvents.length = 0;
    const previousTurnstile = process.env.BOOKING_REQUIRE_TURNSTILE;
    delete process.env.BOOKING_REQUIRE_TURNSTILE;

    try {
        const response = await postBookingRequest(
            new Request("https://espacofacial.com/api/booking/request", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "cf-connecting-ip": "203.0.113.20",
                    "user-agent": "MetaRouteContractTest/1.0",
                    "x-booking-synthetic-test-token": "synthetic-token",
                },
                body: JSON.stringify({
                    unitSlug: "novo-hamburgo",
                    doctorSlug: "dra-teste",
                    doctorName: "Dra. Teste",
                    serviceId: "botox",
                    selectedServiceIds: ["botox"],
                    durationMinutes: 30,
                    date: "2030-01-10",
                    time: "14:00",
                    patientName: "Paciente Sintético",
                    patientGender: "unspecified",
                    email: "route.schedule@example.invalid",
                    whatsapp: "+55 51 99999-0000",
                    trackingContext: acceptedTrackingContext(),
                    metaEventId: "schedule_route_contract",
                }),
            }),
        );

        assert.equal(response.status, 200);
        assert.equal(capturedMetaEvents.length, 1);
        const event = capturedMetaEvents[0];
        assert.equal(event.eventName, "Schedule");
        assert.equal(event.eventId, "schedule_route_contract");
        assert.deepEqual(event.customData, {
            content_type: "booking",
            currency: "BRL",
        });
        assert.deepEqual(Object.keys(event.userData ?? {}).sort(), [
            "clientIpAddress",
            "clientUserAgent",
            "email",
            "externalId",
            "fbc",
            "fbp",
            "phone",
        ]);
        assert.equal(event.userData?.fbp, "fb.1.1860000000.route-browser");
        assert.equal(event.userData?.fbc, "fb.1.1860000000.route-test");
    } finally {
        if (previousTurnstile === undefined) delete process.env.BOOKING_REQUIRE_TURNSTILE;
        else process.env.BOOKING_REQUIRE_TURNSTILE = previousTurnstile;
    }
});

test("WhatsApp redirect route emits Contact without custom data", async () => {
    capturedMetaEvents.length = 0;
    capturedWhatsappRows.length = 0;
    const trackingContext = acceptedTrackingContext();
    const url = new URL("/api/whatsapp/redirect", "https://espacofacial.com");
    url.searchParams.set("dest", "https://wa.me/5551999990000?text=Ol%C3%A1");
    url.searchParams.set("event_id", "contact_route_contract");
    url.searchParams.set("page_url", trackingContext.pageUrl ?? "");
    url.searchParams.set("ctx", JSON.stringify(trackingContext));

    const response = await getWhatsappRedirect(
        new Request(url, {
            headers: {
                "cf-connecting-ip": "203.0.113.21",
                "user-agent": "MetaRouteContractTest/1.0",
            },
        }),
    );

    assert.equal(response.status, 302);
    assert.equal(capturedWhatsappRows.length, 1);
    assert.equal(capturedMetaEvents.length, 1);
    const event = capturedMetaEvents[0];
    assert.equal(event.eventName, "Contact");
    assert.equal(event.eventId, "contact_route_contract");
    assert.equal(Object.hasOwn(event, "customData"), false);
    assert.deepEqual(Object.keys(event.userData ?? {}).sort(), [
        "clientIpAddress",
        "clientUserAgent",
        "fbc",
        "fbp",
    ]);
    assert.equal(event.userData?.fbp, "fb.1.1860000000.route-browser");
    assert.equal(event.userData?.fbc, "fb.1.1860000000.route-test");
});
