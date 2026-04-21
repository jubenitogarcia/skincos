import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import type { TrackingContext } from "@/lib/attribution";

export type MetaServerEvent = {
    eventName: string;
    eventId: string;
    eventTime?: number;
    eventSourceUrl?: string | null;
    actionSource?: "website";
    userData?: {
        email?: string | null;
        phone?: string | null;
        externalId?: string | null;
        clientIpAddress?: string | null;
        clientUserAgent?: string | null;
        fbp?: string | null;
        fbc?: string | null;
    };
    customData?: Record<string, unknown>;
    trackingContext?: TrackingContext | null;
    bookingId?: string | null;
    waClickId?: string | null;
};

type CapiLogWrite = (entry: {
    channel: "server";
    eventName: string;
    eventId: string;
    endpoint: string;
    ok: boolean;
    httpStatus: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    bookingId?: string | null;
    waClickId?: string | null;
}) => Promise<void>;

function normalizeSecret(value: string | null | undefined): string {
    return (value ?? "").trim();
}

function normalizeEmail(value: string | null | undefined): string | null {
    const email = normalizeSecret(value).toLowerCase();
    return email || null;
}

function normalizePhone(value: string | null | undefined): string | null {
    const digits = normalizeSecret(value).replace(/\D/g, "");
    return digits || null;
}

async function sha256Hex(value: string): Promise<string> {
    const encoded = new TextEncoder().encode(value);
    const buffer = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function hashIfPresent(value: string | null): Promise<string[] | undefined> {
    if (!value) return undefined;
    return [await sha256Hex(value)];
}

async function resolveConfig() {
    const pixelId =
        normalizeSecret(await getRuntimeSecret("META_PIXEL_ID")) ||
        normalizeSecret(process.env.NEXT_PUBLIC_META_PIXEL_ID);
    const accessToken = normalizeSecret(await getRuntimeSecret("META_ACCESS_TOKEN"));
    const apiVersion = normalizeSecret(await getRuntimeSecret("META_API_VERSION")) || "v22.0";
    const testEventCode = normalizeSecret(await getRuntimeSecret("META_CAPI_TEST_EVENT_CODE"));
    const debugMode =
        normalizeSecret(await getRuntimeSecret("META_CAPI_DEBUG")) === "1" ||
        normalizeSecret(process.env.NEXT_PUBLIC_META_CAPI_DEBUG) === "1";

    return { pixelId, accessToken, apiVersion, testEventCode, debugMode };
}

export async function sendMetaServerEvent(
    event: MetaServerEvent,
    options: {
        logDelivery?: CapiLogWrite;
    } = {},
): Promise<{ ok: boolean; skipped?: string; httpStatus?: number | null; responseBody?: string | null; error?: string | null }> {
    const config = await resolveConfig();
    if (!config.pixelId || !config.accessToken) {
        return { ok: false, skipped: "missing_meta_capi_config" };
    }

    const consent = event.trackingContext?.consent;
    if (consent?.marketing === false) {
        return { ok: false, skipped: "marketing_consent_denied" };
    }

    const endpoint = `https://graph.facebook.com/${config.apiVersion}/${config.pixelId}/events`;
    const eventTime = event.eventTime ?? Math.floor(Date.now() / 1000);

    const email = normalizeEmail(event.userData?.email);
    const phone = normalizePhone(event.userData?.phone);
    const externalId = normalizeSecret(event.userData?.externalId);

    const payload = {
        data: [
            {
                event_name: event.eventName,
                event_time: eventTime,
                event_id: event.eventId,
                action_source: event.actionSource ?? "website",
                event_source_url: normalizeSecret(event.eventSourceUrl) || undefined,
                custom_data: event.customData,
                user_data: {
                    em: await hashIfPresent(email),
                    ph: await hashIfPresent(phone),
                    external_id: await hashIfPresent(externalId || null),
                    client_ip_address: normalizeSecret(event.userData?.clientIpAddress) || undefined,
                    client_user_agent: normalizeSecret(event.userData?.clientUserAgent) || undefined,
                    fbp: normalizeSecret(event.userData?.fbp) || undefined,
                    fbc: normalizeSecret(event.userData?.fbc) || undefined,
                },
            },
        ],
        partner_agent: "codex_espacofacial_site",
        test_event_code: config.testEventCode || undefined,
    };

    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;

    try {
        const response = await fetch(`${endpoint}?access_token=${encodeURIComponent(config.accessToken)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });

        httpStatus = response.status;
        responseBody = await response.text().catch(() => null);

        if (config.debugMode) {
            console.info("[meta-capi]", {
                eventName: event.eventName,
                eventId: event.eventId,
                httpStatus,
                bookingId: event.bookingId ?? null,
                waClickId: event.waClickId ?? null,
            });
        }

        const ok = response.ok;
        await options.logDelivery?.({
            channel: "server",
            eventName: event.eventName,
            eventId: event.eventId,
            endpoint,
            ok,
            httpStatus,
            responseBody,
            errorMessage: ok ? null : responseBody,
            bookingId: event.bookingId ?? null,
            waClickId: event.waClickId ?? null,
        });

        return ok
            ? { ok: true, httpStatus, responseBody }
            : { ok: false, httpStatus, responseBody, error: responseBody };
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : "unknown_error";

        if (config.debugMode) {
            console.warn("[meta-capi:error]", {
                eventName: event.eventName,
                eventId: event.eventId,
                errorMessage,
            });
        }

        await options.logDelivery?.({
            channel: "server",
            eventName: event.eventName,
            eventId: event.eventId,
            endpoint,
            ok: false,
            httpStatus,
            responseBody,
            errorMessage,
            bookingId: event.bookingId ?? null,
            waClickId: event.waClickId ?? null,
        });

        return { ok: false, httpStatus, responseBody, error: errorMessage };
    }
}
