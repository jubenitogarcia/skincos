import { trackEvent, type AnalyticsEventParams } from "@/lib/analytics";
import { campaignParamsForEvent } from "@/lib/campaign";
import { trackContactConversion, trackLeadConversion } from "@/lib/conversions";
import { readExperienceContextParams } from "@/lib/experienceContext";

export type LeadPlacement =
    | "header"
    | "floating"
    | "about"
    | "doctor"
    | "unit_modal"
    | "doctor_grid"
    | "home_hero"
    | "home_panel"
    | "units_page"
    | "doctors_page"
    | "booking_page"
    | "unknown";

function landingPeriodUtc(): string {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

function withCampaign(params: AnalyticsEventParams): AnalyticsEventParams {
    const campaign = campaignParamsForEvent();
    const experience = readExperienceContextParams(typeof params.page === "string" ? params.page : null);
    return { ...campaign, ...experience, landingPeriod: landingPeriodUtc(), ...params };
}

export function trackAgendarClick(params: {
    placement: LeadPlacement;
    unitSlug: string | null;
    doctorName?: string;
    whatsappUrl?: string;
}) {
    const payload: AnalyticsEventParams = withCampaign({
        placement: params.placement,
        unitSlug: params.unitSlug,
        destination: "whatsapp",
    });

    if (params.doctorName) payload.doctorName = params.doctorName;
    if (params.whatsappUrl) payload.whatsappUrl = params.whatsappUrl;

    trackEvent("cta_agendar_click", payload);
    trackLeadConversion({
        ...readExperienceContextParams(),
        source: "whatsapp",
        placement: params.placement,
        unitSlug: params.unitSlug,
    });
}

export function trackBookingStart(params: {
    placement: LeadPlacement;
    unitSlug: string | null;
    doctorName?: string;
    bookingUrl?: string;
    experience?: string;
    variant?: string;
}) {
    const payload: AnalyticsEventParams = withCampaign({
        placement: params.placement,
        unitSlug: params.unitSlug,
        destination: "booking",
    });

    if (params.doctorName) payload.doctorName = params.doctorName;
    if (params.bookingUrl) payload.bookingUrl = params.bookingUrl;
    if (params.experience) payload.experience = params.experience;
    if (params.variant) payload.variant = params.variant;

    trackEvent("cta_booking_start", payload);
    trackLeadConversion({
        ...readExperienceContextParams(),
        source: "booking",
        placement: params.placement,
        unitSlug: params.unitSlug,
    });
}

export function trackBookingRequestSubmitted(params: {
    bookingId: string;
    unitSlug: string;
    doctorSlug: string;
    serviceId: string;
    durationMinutes: number;
    date: string;
    time: string;
}) {
    trackEvent(
        "booking_request_submitted",
        withCampaign({
            bookingId: params.bookingId,
            unitSlug: params.unitSlug,
            doctorSlug: params.doctorSlug,
            serviceId: params.serviceId,
            durationMinutes: params.durationMinutes,
            date: params.date,
            time: params.time,
        }),
    );
}

export function trackBookingFunnelStep(params: {
    step: string;
    placement?: LeadPlacement;
    unitSlug?: string | null;
    doctorSlug?: string | null;
    serviceId?: string | null;
    date?: string | null;
    time?: string | null;
    detailsStage?: "contact" | "identity" | null;
    restored?: boolean;
}) {
    trackEvent(
        "booking_funnel_step",
        withCampaign({
            step: params.step,
            placement: params.placement ?? "booking_page",
            unitSlug: params.unitSlug ?? null,
            doctorSlug: params.doctorSlug ?? null,
            serviceId: params.serviceId ?? null,
            date: params.date ?? null,
            time: params.time ?? null,
            detailsStage: params.detailsStage ?? null,
            restored: params.restored ?? false,
        }),
    );
}

export function trackExperienceShortcutClick(params: {
    page: string;
    shortcut: string;
    destination: string;
    placement: LeadPlacement;
    unitSlug?: string | null;
    experience?: string;
    variant?: string;
}) {
    trackEvent(
        "experience_shortcut_click",
        withCampaign({
            page: params.page,
            shortcut: params.shortcut,
            destination: params.destination,
            placement: params.placement,
            unitSlug: params.unitSlug ?? null,
            experience: params.experience,
            variant: params.variant,
        }),
    );
}

export function trackDoctorWhatsappClick(params: {
    unitSlug: string | null;
    doctorName: string;
    unitSigla: string;
    whatsappUrl: string;
}) {
    trackEvent("doctor_whatsapp_click", {
        ...withCampaign(params),
    });
    trackContactConversion({
        source: "doctor_whatsapp",
        unitSlug: params.unitSlug,
        doctorName: params.doctorName,
    });
}

export function trackDoctorInstagramClick(params: {
    unitSlug: string | null;
    doctorName: string;
    instagramUrl: string;
}) {
    trackEvent("doctor_instagram_click", {
        ...withCampaign(params),
    });
}

export function trackCtaInstagramClick(params: {
    placement: LeadPlacement;
    unitSlug: string | null;
    instagramUrl: string;
}) {
    trackEvent(
        "cta_instagram_click",
        withCampaign({
            placement: params.placement,
            unitSlug: params.unitSlug,
            instagramUrl: params.instagramUrl,
        })
    );
}

export function trackHeaderInstagramOpen(params: { unitSlug: string | null; mode: "direct" | "picker" }) {
    trackEvent("header_instagram_open", withCampaign(params));
}

export function trackHeaderInstagramClick(params: { unitSlug: string | null; mode: "direct" | "picker" }) {
    trackEvent("header_instagram_click", withCampaign(params));
}
