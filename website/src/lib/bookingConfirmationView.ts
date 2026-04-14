import { units } from "@/data/units";

export type PatientGender = "male" | "female" | "unspecified";

export type BookingConfirmationPayload = {
    id: string;
    unitSlug: string;
    procedureName: string;
    date: string;
    time: string;
    patientName: string;
    patientGender: PatientGender;
    email: string;
    whatsapp: string;
    doctorName?: string;
};

export type BookingConfirmationViewModel = {
    unitName: string;
    unitAddress: string;
    appointmentDate: string;
    appointmentTime: string;
    reservationCode: string;
    customerName: string;
    customerEmail: string;
    customerWhatsapp: string;
    procedureName: string;
    doctorName: string | null;
    ambassadorName: string;
    ambassadorImageUrl: string;
    logoUrl: string;
    reservationDetailsUrl: string;
    teamContactUrl: string;
    unitInstagramUrl: string;
    unitInstagramLabel: string;
    unitFacebookUrl: string;
    unitFacebookLabel: string;
    unitWhatsappUrl: string;
    unitWhatsappLabel: string;
    nextSteps: string[];
};

type BuildBookingConfirmationOptions = {
    siteUrl?: string;
    logoUrl?: string;
    maleAmbassadorImageUrl?: string;
    femaleAmbassadorImageUrl?: string;
    reservationDetailsUrl?: string;
    teamContactUrl?: string;
};

function unitFromSlug(slug: string) {
    return units.find((unit) => unit.slug === slug);
}

export function resolveBookingSiteUrl(explicitSiteUrl?: string): string {
    const raw = (explicitSiteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").trim();
    return raw.replace(/\/$/, "");
}

export function formatDatePtBr(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map((value) => Number(value));
    if (!y || !m || !d) return dateKey;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function stripPhoneToDigits(value: string): string {
    return (value ?? "").replace(/\D/g, "");
}

export function formatWhatsappDisplay(value: string): string {
    const digitsRaw = stripPhoneToDigits(value);
    const digits = digitsRaw.startsWith("55") ? digitsRaw.slice(2) : digitsRaw;
    const ddd = digits.slice(0, 2);
    const prefix = digits.slice(2, 7);
    const suffix = digits.slice(7, 11);
    if (!ddd || !prefix || !suffix) return value || "";
    return `+55 (${ddd}) ${prefix}-${suffix}`;
}

export function absoluteUrl(siteUrl: string, raw: string): string {
    const value = (raw ?? "").trim();
    if (!value) return siteUrl;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) return `${siteUrl}${value}`;
    return `${siteUrl}/${value}`;
}

export function sanitizeUrl(value: string, fallback: string): string {
    const raw = (value ?? "").trim();
    if (!raw) return fallback;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
    return fallback;
}

function parseInstagramLabel(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const handle = pathname.split("/").filter(Boolean)[0] ?? "";
        return handle ? `@${handle.replace(/^@/, "")}` : "Instagram";
    } catch {
        return "Instagram";
    }
}

function parseFacebookLabel(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/$/, "");
        return `${parsed.hostname}${path}`;
    } catch {
        return "Facebook";
    }
}

function ambassadorForGender(
    gender: PatientGender,
    siteUrl: string,
    overrides?: Pick<BuildBookingConfirmationOptions, "maleAmbassadorImageUrl" | "femaleAmbassadorImageUrl">,
) {
    const male = {
        name: "Márcio Garcia",
        imageUrl: absoluteUrl(siteUrl, overrides?.maleAmbassadorImageUrl ?? "/images/email/ambassadors/marcio-garcia-u3a7227.jpg"),
    };
    const female = {
        name: "Deborah Secco",
        imageUrl: absoluteUrl(siteUrl, overrides?.femaleAmbassadorImageUrl ?? "/images/email/ambassadors/deborah-secco-20244437.jpeg"),
    };
    return gender === "male" ? male : female;
}

export function buildBookingConfirmationViewModel(
    payload: BookingConfirmationPayload,
    options: BuildBookingConfirmationOptions = {},
): BookingConfirmationViewModel {
    const siteUrl = resolveBookingSiteUrl(options.siteUrl);
    const unit = unitFromSlug(payload.unitSlug);
    const unitName = unit?.name ?? payload.unitSlug;
    const unitAddress =
        [unit?.addressLine ?? "", unit?.state ? `- ${unit.state}` : ""].filter(Boolean).join(" ").trim() || unitName;

    const instagramUrl = sanitizeUrl(unit?.instagram ?? "", `${siteUrl}/`);
    const facebookUrl = sanitizeUrl(unit?.facebook ?? "", `${siteUrl}/`);
    const unitWhatsappRaw = unit?.whatsappPhone ?? payload.whatsapp;
    const unitWhatsappDigits = stripPhoneToDigits(unitWhatsappRaw);
    const whatsappUrl = sanitizeUrl(
        unitWhatsappDigits ? `https://api.whatsapp.com/send?phone=${unitWhatsappDigits}` : "",
        `${siteUrl}/`,
    );

    const teamContactUrl = sanitizeUrl(
        options.teamContactUrl ?? (unit?.contactUrl ? absoluteUrl(siteUrl, unit.contactUrl) : whatsappUrl),
        whatsappUrl,
    );
    const reservationDetailsUrl = sanitizeUrl(
        options.reservationDetailsUrl ?? `${siteUrl}/agendamento#booking-flow`,
        `${siteUrl}/agendamento`,
    );

    const ambassador = ambassadorForGender(payload.patientGender, siteUrl, {
        maleAmbassadorImageUrl: options.maleAmbassadorImageUrl,
        femaleAmbassadorImageUrl: options.femaleAmbassadorImageUrl,
    });

    return {
        unitName,
        unitAddress,
        appointmentDate: formatDatePtBr(payload.date),
        appointmentTime: payload.time,
        reservationCode: payload.id,
        customerName: payload.patientName,
        customerEmail: payload.email,
        customerWhatsapp: formatWhatsappDisplay(payload.whatsapp),
        procedureName: payload.procedureName,
        doctorName: payload.doctorName?.trim() ? payload.doctorName.trim() : null,
        ambassadorName: ambassador.name,
        ambassadorImageUrl: sanitizeUrl(ambassador.imageUrl, `${siteUrl}/logo.png`),
        logoUrl: sanitizeUrl(absoluteUrl(siteUrl, options.logoUrl ?? "/logo.png"), `${siteUrl}/logo.png`),
        reservationDetailsUrl,
        teamContactUrl,
        unitInstagramUrl: instagramUrl,
        unitInstagramLabel: parseInstagramLabel(instagramUrl),
        unitFacebookUrl: facebookUrl,
        unitFacebookLabel: parseFacebookLabel(facebookUrl),
        unitWhatsappUrl: whatsappUrl,
        unitWhatsappLabel: formatWhatsappDisplay(unitWhatsappRaw),
        nextSteps: [
            "Guarde os detalhes da reserva para qualquer ajuste futuro.",
            "Se precisar alterar algo, fale direto com a equipe da unidade.",
            "Chegue com alguns minutos de antecedência para o atendimento.",
        ],
    };
}
