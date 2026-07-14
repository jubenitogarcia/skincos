export type ExperienceContextEntry = {
    page: string;
    experience: string;
    variant: string;
    variantSource: "default" | "query" | "campaign" | "session";
    updatedAtMs: number;
};

type ExperienceContextState = {
    v: 1;
    activePage: string | null;
    byPage: Record<string, ExperienceContextEntry>;
};

const EXPERIENCE_CONTEXT_KEY = "ef_experience_context_v1";

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

function parseState(raw: string | null): ExperienceContextState | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as ExperienceContextState;
        if (!parsed || parsed.v !== 1 || typeof parsed.byPage !== "object") return null;
        return parsed;
    } catch {
        return null;
    }
}

function readRawState(): ExperienceContextState | null {
    if (!isBrowser()) return null;
    const fromSession = (() => {
        try {
            return parseState(window.sessionStorage.getItem(EXPERIENCE_CONTEXT_KEY));
        } catch {
            return null;
        }
    })();
    if (fromSession) return fromSession;

    try {
        return parseState(window.localStorage.getItem(EXPERIENCE_CONTEXT_KEY));
    } catch {
        return null;
    }
}

function writeRawState(state: ExperienceContextState): void {
    if (!isBrowser()) return;
    const encoded = JSON.stringify(state);
    try {
        window.sessionStorage.setItem(EXPERIENCE_CONTEXT_KEY, encoded);
    } catch {
        // noop
    }
    try {
        window.localStorage.setItem(EXPERIENCE_CONTEXT_KEY, encoded);
    } catch {
        // noop
    }
}

export function persistExperienceContext(input: Omit<ExperienceContextEntry, "updatedAtMs">): void {
    if (!isBrowser()) return;
    const state = readRawState() ?? { v: 1, activePage: null, byPage: {} };
    const entry: ExperienceContextEntry = {
        ...input,
        updatedAtMs: Date.now(),
    };
    state.byPage[entry.page] = entry;
    state.activePage = entry.page;
    writeRawState(state);
}

export function readExperienceContext(pageHint?: string | null): ExperienceContextEntry | null {
    const state = readRawState();
    if (!state) return null;

    if (pageHint) {
        const byHint = state.byPage[pageHint];
        if (byHint) return byHint;
    }

    if (state.activePage) {
        const active = state.byPage[state.activePage];
        if (active) return active;
    }

    const entries = Object.values(state.byPage);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return entries[0] ?? null;
}

export function readExperienceContextParams(pageHint?: string | null): Record<string, string> {
    const entry = readExperienceContext(pageHint);
    if (!entry) return {};
    return {
        experience: entry.experience,
        variant: entry.variant,
        variantSource: entry.variantSource,
        experiencePage: entry.page,
    };
}
