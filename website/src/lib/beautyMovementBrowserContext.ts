export const BEAUTY_MOVEMENT_INVITE_STORAGE_KEY = "ef:beauty-movement:invite";
export const BEAUTY_MOVEMENT_HANDOFF_ATTEMPT_KEY = "ef:beauty-movement:handoff-attempt";
export const BEAUTY_MOVEMENT_HANDOFF_EVENT = "beauty-movement-invite-handoff";
export const BEAUTY_MOVEMENT_HISTORY_CONTEXT_KEY = "__efBeautyMovementContextRef";

const CONTEXT_STORAGE_PREFIX = "ef:beauty-movement:context:";
const CONTEXT_INDEX_KEY = "ef:beauty-movement:contexts";
const MAX_CONTEXT_MARKERS = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,180}$/;
const CONTEXT_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export type BeautyMovementInviteHandoff = {
    attempted: boolean;
    token: string | null;
};

type BeautyMovementHandoffWindow = Window & {
    __efBeautyMovementInviteHandoff?: BeautyMovementInviteHandoff;
};

export function isBeautyMovementInviteToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function isBeautyMovementContextRef(value: unknown): value is string {
    return typeof value === "string" && CONTEXT_PATTERN.test(value);
}

export function parseBeautyMovementInviteFragment(fragment: string): BeautyMovementInviteHandoff {
    const normalized = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (!normalized) return { attempted: false, token: null };
    try {
        const params = new URLSearchParams(normalized);
        if (!params.has("c")) return { attempted: false, token: null };
        const token = params.get("c");
        return { attempted: true, token: isBeautyMovementInviteToken(token) ? token : null };
    } catch {
        return { attempted: true, token: null };
    }
}

export function consumeBeautyMovementInviteHandoff(host: Window = window): BeautyMovementInviteHandoff {
    const handoffHost = host as BeautyMovementHandoffWindow;
    const inMemory = handoffHost.__efBeautyMovementInviteHandoff;
    try {
        delete handoffHost.__efBeautyMovementInviteHandoff;
    } catch {
        handoffHost.__efBeautyMovementInviteHandoff = undefined;
    }

    let attempted = inMemory?.attempted === true;
    let token = isBeautyMovementInviteToken(inMemory?.token) ? inMemory.token : null;
    try {
        const storedToken = host.sessionStorage.getItem(BEAUTY_MOVEMENT_INVITE_STORAGE_KEY);
        attempted = attempted
            || host.sessionStorage.getItem(BEAUTY_MOVEMENT_HANDOFF_ATTEMPT_KEY) === "1"
            || storedToken !== null;
        if (!token && isBeautyMovementInviteToken(storedToken)) token = storedToken;
        host.sessionStorage.removeItem(BEAUTY_MOVEMENT_INVITE_STORAGE_KEY);
        host.sessionStorage.removeItem(BEAUTY_MOVEMENT_HANDOFF_ATTEMPT_KEY);
    } catch {
        // The synchronous layout handoff remains available in memory. If both
        // channels fail, attempted=false and the page must still have an
        // explicitly bound history context before it can resume.
    }
    return { attempted, token: attempted ? token : null };
}

function rememberContextMarker(host: Window, contextRef: string): void {
    try {
        const stored = host.sessionStorage.getItem(CONTEXT_INDEX_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        const previous = Array.isArray(parsed)
            ? parsed.filter((value): value is string => isBeautyMovementContextRef(value))
            : [];
        const next = [contextRef, ...previous.filter((value) => value !== contextRef)].slice(0, MAX_CONTEXT_MARKERS);
        host.sessionStorage.setItem(`${CONTEXT_STORAGE_PREFIX}${contextRef}`, "1");
        host.sessionStorage.setItem(CONTEXT_INDEX_KEY, JSON.stringify(next));
        for (const stale of previous.slice(MAX_CONTEXT_MARKERS - 1)) {
            if (!next.includes(stale)) host.sessionStorage.removeItem(`${CONTEXT_STORAGE_PREFIX}${stale}`);
        }
    } catch {
        // history.state remains the authoritative per-entry selector when
        // storage is unavailable. The HttpOnly cookie still gates all access.
    }
}

export function bindBeautyMovementContextRef(contextRef: string, host: Window = window): void {
    if (!isBeautyMovementContextRef(contextRef)) throw new Error("beauty_movement_invalid_context_ref");
    const current = host.history.state;
    const nextState = (current && typeof current === "object" ? { ...current } : {}) as Record<string, unknown>;
    nextState[BEAUTY_MOVEMENT_HISTORY_CONTEXT_KEY] = contextRef;
    host.history.replaceState(nextState, "", `${host.location.pathname}${host.location.search}`);
    rememberContextMarker(host, contextRef);
}

export function readBeautyMovementContextRef(host: Window = window): string | null {
    const current = host.history.state;
    if (!current || typeof current !== "object") return null;
    const contextRef = (current as Record<string, unknown>)[BEAUTY_MOVEMENT_HISTORY_CONTEXT_KEY];
    return isBeautyMovementContextRef(contextRef) ? contextRef : null;
}

export function clearBeautyMovementContextRef(host: Window = window): void {
    const current = host.history.state;
    if (!current || typeof current !== "object") return;
    const nextState = { ...current } as Record<string, unknown>;
    delete nextState[BEAUTY_MOVEMENT_HISTORY_CONTEXT_KEY];
    host.history.replaceState(nextState, "", `${host.location.pathname}${host.location.search}`);
}
