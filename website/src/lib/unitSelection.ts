const STORAGE_KEY = "ef:selectedUnitSlug";

export function getStoredUnitSlug(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return value && value.trim() ? value : null;
    } catch {
        return null;
    }
}

export function setStoredUnitSlug(slug: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, slug);
        window.dispatchEvent(new CustomEvent("ef:unit-change", { detail: { slug } }));
    } catch {
        // Ignore storage failures (private mode, blocked storage, etc.)
    }
}
