import { getCloudflareContext } from "@opennextjs/cloudflare";
import { doctorSlugFromTeamMember } from "@/lib/doctorSlug";

type TeamMember = {
    name: string;
    nickname: string | null;
    units: string[];
    role: string;
    roles: string[];
    instagramHandle: string | null;
    instagramUrl: string | null;
};

export type InjectorsDirectoryError =
    | { code: "http_error"; status: number }
    | { code: "auth_not_configured" }
    | { code: "auth_invalid_json" }
    | { code: "auth_missing_fields" }
    | { code: "auth_token_failed"; status: number }
    | { code: "sheets_api_failed"; status: number }
    | { code: "sheet_not_found"; gid: number }
    | { code: "unexpected_content_type"; contentType: string | null }
    | { code: "html_response" }
    | { code: "exception" };

const SHEET_ID = "1OBJ3RAjQqV3cQNN8xzSbRgu4leTMsSFM2X5TOnrGmSI";
const GID_EQUIPE = "1377081461";

type CloudflareEnv = {
    // Preferred names for this project:
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?: string;
    GOOGLE_SHEETS_SHEET_ID?: string;
    GOOGLE_SHEETS_GID_EQUIPE?: string;

    // Existing secret used elsewhere (can optionally be reused for Sheets too):
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
};

type InjectorsResult = { ok: true; members: TeamMember[] } | { ok: false; members: TeamMember[]; error: InjectorsDirectoryError };
type InjectorsCacheEntry = {
    expiresAtMs: number;
    result: InjectorsResult;
};

const INJECTORS_CACHE_TTL_MS = 5 * 60_000;
const INJECTORS_ERROR_CACHE_TTL_MS = 10_000;
let injectorsCache: InjectorsCacheEntry | null = null;
let inflightInjectorsLoad: Promise<InjectorsResult> | null = null;

type GoogleServiceAccount = {
    client_email?: string;
    private_key?: string;
};

class StatusError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

class GidError extends Error {
    gid: number;
    constructor(message: string, gid: number) {
        super(message);
        this.gid = gid;
    }
}

function getEnv(): CloudflareEnv {
    const { env } = getCloudflareContext();
    return env as unknown as CloudflareEnv;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
    const b64 = btoa(binary);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(text: string): string {
    return bytesToBase64Url(new TextEncoder().encode(text));
}

function pemToDer(pem: string): ArrayBuffer | null {
    const cleaned = (pem ?? "")
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, "")
        .trim();
    if (!cleaned) return null;
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function signJwtRs256(privateKeyPem: string, input: string): Promise<string> {
    const der = pemToDer(privateKeyPem);
    if (!der) throw new Error("invalid_private_key");

    const key = await crypto.subtle.importKey(
        "pkcs8",
        der,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
    return bytesToBase64Url(new Uint8Array(sig));
}

type TokenCache = { token: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

async function getGoogleAccessToken(serviceAccount: GoogleServiceAccount, scope: string): Promise<string> {
    const now = Date.now();
    if (tokenCache && now + 30_000 < tokenCache.expiresAtMs) return tokenCache.token;

    const iss = (serviceAccount.client_email ?? "").trim();
    const key = (serviceAccount.private_key ?? "").trim();
    if (!iss || !key) throw new Error("auth_missing_fields");

    const aud = "https://oauth2.googleapis.com/token";
    const iat = Math.floor(now / 1000);
    const exp = iat + 60 * 30;

    const header = { alg: "RS256", typ: "JWT" };
    const payload = { iss, scope, aud, iat, exp };

    const encodedHeader = textToBase64Url(JSON.stringify(header));
    const encodedPayload = textToBase64Url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await signJwtRs256(key, signingInput);
    const assertion = `${signingInput}.${signature}`;

    const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
    }).toString();

    const res = await fetch(aud, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!res.ok) {
        throw new StatusError("auth_token_failed", res.status);
    }

    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    const accessToken = (json?.access_token ?? "").trim();
    const expiresIn = Number(json?.expires_in ?? 0);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("auth_token_invalid_response");

    tokenCache = { token: accessToken, expiresAtMs: now + expiresIn * 1000 };
    return accessToken;
}

async function resolveSheetTitleByGid(opts: { accessToken: string; sheetId: string; gid: number }): Promise<string | null> {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(opts.sheetId)}`);
    url.searchParams.set("fields", "sheets(properties(sheetId,title))");

    const res = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${opts.accessToken}` },
    });
    if (!res.ok) {
        throw new StatusError("sheets_api_failed", res.status);
    }

    const json = (await res.json().catch(() => null)) as
        | { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }
        | null;
    const sheets = Array.isArray(json?.sheets) ? json!.sheets! : [];
    for (const s of sheets) {
        const id = Number(s?.properties?.sheetId ?? NaN);
        const title = (s?.properties?.title ?? "").trim();
        if (Number.isFinite(id) && id === opts.gid && title) return title;
    }
    return null;
}

function escapeA1SheetTitle(title: string): string {
    const safe = (title ?? "").replace(/'/g, "''");
    return `'${safe}'`;
}

async function fetchSheetRowsViaApi(opts: { serviceAccountJson: string; sheetId: string; gidEquipe?: string }): Promise<string[][]> {
    let serviceAccount: GoogleServiceAccount | null = null;
    try {
        serviceAccount = JSON.parse(opts.serviceAccountJson) as GoogleServiceAccount;
    } catch {
        throw new Error("auth_invalid_json");
    }

    const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
    const accessToken = await getGoogleAccessToken(serviceAccount, scope);

    const gid = Number((opts.gidEquipe ?? "").trim() || NaN);
    let title: string | null = null;
    if (Number.isFinite(gid)) {
        title = await resolveSheetTitleByGid({ accessToken, sheetId: opts.sheetId, gid });
        if (!title) {
            throw new GidError("sheet_not_found", gid);
        }
    }

    const range = title ? `${escapeA1SheetTitle(title)}!A:Z` : "A:Z";
    const valuesUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(opts.sheetId)}/values/${encodeURIComponent(range)}`);
    valuesUrl.searchParams.set("majorDimension", "ROWS");

    const res = await fetch(valuesUrl.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
        throw new StatusError("sheets_api_failed", res.status);
    }

    const json = (await res.json().catch(() => null)) as { values?: unknown[][] } | null;
    const values = Array.isArray(json?.values) ? json!.values! : [];
    return values.map((row) => (Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : []));
}

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                const next = text[i + 1];
                if (next === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            continue;
        }

        if (ch === ",") {
            row.push(cell);
            cell = "";
            continue;
        }

        if (ch === "\n") {
            row.push(cell);
            cell = "";
            if (row.some((c) => c.trim().length > 0)) rows.push(row);
            row = [];
            continue;
        }

        if (ch === "\r") continue;

        cell += ch;
    }

    row.push(cell);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);

    return rows;
}

function normalizeInstagramHandle(value: string): string | null {
    const v = value.trim();
    if (!v) return null;

    // Accept @handle
    const at = v.startsWith("@") ? v.slice(1) : v;

    // Accept URL
    const m = at.match(/instagram\.com\/(?:@)?([^/?#]+)/i);
    const handle = (m ? m[1] : at).trim();

    const cleaned = handle.replace(/[^a-zA-Z0-9._]/g, "");
    return cleaned ? cleaned : null;
}

function normalizeUnits(value: string): string[] {
    const v = value.trim();
    if (!v) return [];

    return v
        .split(/,|\/|\||;|\be\/?ou\b|\be\b/gi)
        .map((s) => s.trim())
        .filter(Boolean);
}

function normalizeRoles(value: string): string[] {
    const v = value.trim();
    if (!v) return [];

    return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

export { doctorSlugFromTeamMember };

export function unitLabelFromBookingUnitSlug(unitSlug: string): string | null {
    if (unitSlug === "barrashoppingsul") return "BarraShoppingSul";
    if (unitSlug === "novo-hamburgo" || unitSlug === "novohamburgo") return "Novo Hamburgo";
    return null;
}

export async function fetchActiveInjectorsResult(): Promise<InjectorsResult> {
    const now = Date.now();
    if (injectorsCache && injectorsCache.expiresAtMs > now) return injectorsCache.result;
    if (inflightInjectorsLoad) return inflightInjectorsLoad;

    inflightInjectorsLoad = (async () => {
    try {
        const env = getEnv();
        const serviceAccountJson = (env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON ?? env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
        const sheetId = (env.GOOGLE_SHEETS_SHEET_ID ?? SHEET_ID).trim();
        const gidEquipe = (env.GOOGLE_SHEETS_GID_EQUIPE ?? GID_EQUIPE).trim();

        let rows: string[][] = [];

        if (serviceAccountJson) {
            try {
                rows = await fetchSheetRowsViaApi({ serviceAccountJson, sheetId, gidEquipe });
            } catch (e) {
                if (e instanceof Error && e.message === "auth_invalid_json") return { ok: false, members: [], error: { code: "auth_invalid_json" } };
                if (e instanceof Error && e.message === "auth_missing_fields") return { ok: false, members: [], error: { code: "auth_missing_fields" } };
                if (e instanceof GidError && e.message === "sheet_not_found") return { ok: false, members: [], error: { code: "sheet_not_found", gid: e.gid } };
                if (e instanceof StatusError && e.message === "auth_token_failed") return { ok: false, members: [], error: { code: "auth_token_failed", status: e.status } };
                if (e instanceof StatusError && e.message === "sheets_api_failed") return { ok: false, members: [], error: { code: "sheets_api_failed", status: e.status } };
                return { ok: false, members: [], error: { code: "exception" } };
            }
        } else {
            // Fallback to public CSV fetch (only works if the sheet is public).
            const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID_EQUIPE}`;
            const res = await fetch(url, {
                // Cache at the edge for a while; Google Sheets doesn’t change every second.
                next: { revalidate: 60 * 30 },
            });

            if (!res.ok) {
                return { ok: false, members: [], error: { code: "http_error", status: res.status } };
            }

            const contentType = res.headers.get("content-type");
            if (contentType && !contentType.toLowerCase().includes("text/csv")) {
                return { ok: false, members: [], error: { code: "unexpected_content_type", contentType } };
            }

            const csv = await res.text();
            if (/^\s*</.test(csv)) {
                return { ok: false, members: [], error: { code: "html_response" } };
            }

            rows = parseCsv(csv);
        }

        const members: TeamMember[] = [];

        for (const row of rows) {
            const name = (row[0] ?? "").trim();
            const status = (row[1] ?? "").trim().toLowerCase();
            const unitCell = (row[2] ?? "").trim();
            const role = (row[3] ?? "").trim();
            const nickname = (row[5] ?? "").trim();
            const instagram = (row[8] ?? "").trim();

            // Skip header-ish rows
            if (!name || name.toLowerCase() === "nome") continue;
            if (status !== "ativo") continue;

            const roles = normalizeRoles(role);
            const isInjector = roles.length
                ? roles.some((r) => r.toLowerCase() === "injetor")
                : role.toLowerCase() === "injetor";
            if (!isInjector) continue;

            const units = normalizeUnits(unitCell);
            const instagramHandle = normalizeInstagramHandle(instagram);
            const instagramUrl = instagramHandle ? `https://www.instagram.com/${instagramHandle}/` : null;

            members.push({
                name,
                nickname: nickname || null,
                units,
                role: roles.length ? roles.join(", ") : role,
                roles,
                instagramHandle,
                instagramUrl,
            });
        }

        // Deterministic output
        members.sort((a, b) => (a.nickname ?? a.name).localeCompare(b.nickname ?? b.name));

        return { ok: true, members };
    } catch {
        return { ok: false, members: [], error: { code: "exception" } };
    }
    })();

    try {
        const result = await inflightInjectorsLoad;
        injectorsCache = {
            expiresAtMs: Date.now() + (result.ok ? INJECTORS_CACHE_TTL_MS : INJECTORS_ERROR_CACHE_TTL_MS),
            result,
        };
        return result;
    } finally {
        inflightInjectorsLoad = null;
    }
}

export async function fetchActiveInjectors(): Promise<TeamMember[]> {
    const result = await fetchActiveInjectorsResult();
    return result.members;
}

export async function getUnitDoctorsResult(unitSlug: string): Promise<
    | { ok: true; doctors: Array<{ slug: string; name: string }> }
    | { ok: false; doctors: Array<{ slug: string; name: string }>; error: InjectorsDirectoryError }
> {
    const label = unitLabelFromBookingUnitSlug(unitSlug);
    if (!label) return { ok: true, doctors: [] };

    const membersResult = await fetchActiveInjectorsResult();
    if (!membersResult.ok) return { ok: false, doctors: [], error: membersResult.error };

    const doctors = membersResult.members
        .filter((m) => m.units.map((u) => u.toLowerCase()).includes(label.toLowerCase()))
        .map((m) => ({ slug: doctorSlugFromTeamMember(m), name: m.name }));

    return { ok: true, doctors };
}

export async function getUnitDoctors(unitSlug: string): Promise<Array<{ slug: string; name: string }>> {
    const result = await getUnitDoctorsResult(unitSlug);
    return result.doctors;
}
