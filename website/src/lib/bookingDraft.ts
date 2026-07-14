type BookingDraftStep = "pick" | "details";

export type BookingDraftState = {
    unitSlug: string | null;
    doctorSlug: string | null;
    doctorName: string | null;
    doctorHandle: string | null;
    serviceId: string | null;
    serviceIds: string[];
    includeAvaliacao: boolean;
    includeProcedimento: boolean;
    includeRevisao: boolean;
    dateKey: string | null;
    timeKey: string | null;
    step: BookingDraftStep;
    patientName: string;
    patientGender: string;
    email: string;
    whatsapp: string;
    notes: string;
};

type BookingDraftPayload = BookingDraftState & {
    v: 2;
    updatedAtMs: number;
};

const STORAGE_KEY = "ef:booking-draft:v2";
const TTL_MS = 1000 * 60 * 60 * 24;

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

function parseDraft(raw: string | null): BookingDraftPayload | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as BookingDraftPayload;
        if (!parsed || parsed.v !== 2 || typeof parsed.updatedAtMs !== "number") return null;
        if (Date.now() - parsed.updatedAtMs > TTL_MS) return null;
        return parsed;
    } catch {
        return null;
    }
}

function readRawDraft(): BookingDraftPayload | null {
    if (!isBrowser()) return null;

    const fromSession = (() => {
        try {
            return parseDraft(window.sessionStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    })();
    if (fromSession) return fromSession;

    try {
        return parseDraft(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

export function readBookingDraft(): BookingDraftState | null {
    const raw = readRawDraft();
    if (!raw) return null;
    return {
        unitSlug: raw.unitSlug,
        doctorSlug: raw.doctorSlug,
        doctorName: raw.doctorName,
        doctorHandle: raw.doctorHandle,
        serviceId: raw.serviceId,
        serviceIds: Array.isArray((raw as { serviceIds?: unknown }).serviceIds)
            ? ((raw as { serviceIds?: unknown[] }).serviceIds ?? []).map((item) => String(item)).filter(Boolean)
            : raw.serviceId
                ? [raw.serviceId]
                : [],
        includeAvaliacao: raw.includeAvaliacao,
        includeProcedimento: raw.includeProcedimento,
        includeRevisao: raw.includeRevisao,
        dateKey: raw.dateKey,
        timeKey: raw.timeKey,
        step: raw.step,
        patientName: raw.patientName,
        patientGender: typeof (raw as { patientGender?: unknown }).patientGender === "string" ? (raw as { patientGender?: string }).patientGender ?? "" : "",
        email: raw.email,
        whatsapp: raw.whatsapp,
        notes: raw.notes,
    };
}

export function persistBookingDraft(input: BookingDraftState): void {
    if (!isBrowser()) return;
    const payload: BookingDraftPayload = {
        ...input,
        v: 2,
        updatedAtMs: Date.now(),
    };
    const encoded = JSON.stringify(payload);

    try {
        window.sessionStorage.setItem(STORAGE_KEY, encoded);
    } catch {
        // noop
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, encoded);
    } catch {
        // noop
    }
}

export function clearBookingDraft(): void {
    if (!isBrowser()) return;
    try {
        window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        // noop
    }
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // noop
    }
}
