import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaScheduleCustomData } from "../src/lib/metaEventContracts";

test("browser Schedule call site uses the exact minimized Meta payload", () => {
    assert.deepEqual(buildMetaScheduleCustomData(), {
        content_type: "booking",
        currency: "BRL",
    });
});

test("browser Contact preserves Google Ads attribution but minimizes Meta", async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    const previousSendTo = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO;
    const metaCalls: unknown[][] = [];
    const googleCalls: unknown[][] = [];
    const storage = new Map<string, string>();
    const attribution = {
        placement: "sticky_whatsapp",
        source: "site",
        unit_slug: "novo-hamburgo",
        doctor_slug: "internal-doctor",
        fbclid: "internal-click-id",
    };

    process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO = "test-contact-destination";
    globals.document = { cookie: "ef_cookie_consent_v2=v=2&a=1&m=1" };
    globals.window = {
        fbq: (...args: unknown[]) => metaCalls.push(args),
        gtag: (...args: unknown[]) => googleCalls.push(args),
        sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => {
                storage.set(key, value);
            },
        },
    };

    try {
        const { trackContactConversion } = await import("../src/lib/conversions");
        trackContactConversion(
            attribution,
            { eventId: "contact_browser_minimized" },
        );

        assert.deepEqual(googleCalls, [
            [
                "event",
                "conversion",
                {
                    send_to: "test-contact-destination",
                    ...attribution,
                },
            ],
        ]);
        assert.deepEqual(metaCalls, [
            ["track", "Contact", {}, { eventID: "contact_browser_minimized" }],
        ]);
    } finally {
        if (previousSendTo === undefined) {
            delete process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO;
        } else {
            process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO = previousSendTo;
        }
        if (previousWindow === undefined) delete globals.window;
        else globals.window = previousWindow;
        if (previousDocument === undefined) delete globals.document;
        else globals.document = previousDocument;
    }
});
