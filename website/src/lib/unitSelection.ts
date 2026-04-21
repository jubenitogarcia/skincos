export const UNIT_SELECTION_STORAGE_KEY = "ef:selectedUnitSlug";
export const UNIT_SELECTION_COOKIE_KEY = "ef_selected_unit";

type SearchParamsLike =
    | URLSearchParams
    | {
        entries(): IterableIterator<[string, string]>;
    };

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const cookies = document.cookie
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
    const prefix = `${name}=`;
    const match = cookies.find((entry) => entry.startsWith(prefix));
    if (!match) return null;
    const value = match.slice(prefix.length).trim();
    return value ? decodeURIComponent(value) : null;
}

export function getStoredUnitSlug(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.localStorage.getItem(UNIT_SELECTION_STORAGE_KEY);
        if (value && value.trim()) return value;
        return readCookie(UNIT_SELECTION_COOKIE_KEY);
    } catch {
        return readCookie(UNIT_SELECTION_COOKIE_KEY);
    }
}

export function setStoredUnitSlug(slug: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(UNIT_SELECTION_STORAGE_KEY, slug);
        document.cookie = `${UNIT_SELECTION_COOKIE_KEY}=${encodeURIComponent(slug)}; Path=/; Max-Age=31536000; SameSite=Lax`;
        window.dispatchEvent(new CustomEvent("ef:unit-change", { detail: { slug } }));
    } catch {
        // Ignore storage failures (private mode, blocked storage, etc.)
        try {
            document.cookie = `${UNIT_SELECTION_COOKIE_KEY}=${encodeURIComponent(slug)}; Path=/; Max-Age=31536000; SameSite=Lax`;
        } catch {
            // Ignore cookie failures as well.
        }
    }
}

export function buildUnitSelectionHref(params: {
    pathname: string | null | undefined;
    searchParams?: SearchParamsLike | null;
    nextUnitSlug: string;
}): string | null {
    const pathname = (params.pathname ?? "").trim();
    if (pathname !== "/agendamento") return null;

    const nextSearchParams = new URLSearchParams(
        params.searchParams ? Array.from(params.searchParams.entries()) : [],
    );

    nextSearchParams.set("unit", params.nextUnitSlug);

    // Switching units should start a fresh booking context rather than replaying
    // selection or confirmation state from the previous unit.
    for (const key of ["doctor", "service", "autopick", "autopick_nonce", "booking", "statusToken"]) {
        nextSearchParams.delete(key);
    }

    const query = nextSearchParams.toString();
    return query ? `${pathname}?${query}#booking-flow` : `${pathname}#booking-flow`;
}
