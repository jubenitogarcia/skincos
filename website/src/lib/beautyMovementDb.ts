import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
    BEAUTY_MOVEMENT_SESSION_COOKIE,
    createBeautyMovementOpaqueToken,
    decryptBeautyMovementPersonalData,
    encryptBeautyMovementPersonalData,
    hashBeautyMovementInviteToken,
    hashBeautyMovementIp,
    hashBeautyMovementSessionToken,
    isBeautyMovementOpaqueToken,
    isBeautyMovementOriginAllowed,
    resolveBeautyMovementAllowedOriginsAtRuntime,
    type BeautyMovementEncryptedPersonalData,
} from "@/lib/beautyMovementSecurity";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import type { BeautyMovementBenefitStatus, BeautyMovementInviteStatus, BeautyMovementPalette } from "@/lib/beautyMovementImport";
import type {
    BeautyMovementDiscountKind,
    BeautyMovementRewardType,
    BeautyMovementVelocityBenefit,
} from "@/lib/beautyMovementRewards";
import {
    BEAUTY_MOVEMENT_OUTCOME_KEYS,
    BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION,
    getBeautyMovementOffer,
    resolveBeautyMovementOutcome,
    type BeautyMovementOffer,
    type BeautyMovementOutcomeKey,
} from "@/lib/beautyMovementOutcomes";

export { BEAUTY_MOVEMENT_SESSION_COOKIE } from "@/lib/beautyMovementSecurity";

export const BEAUTY_MOVEMENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EXCHANGE_RATE_LIMIT = { scope: "invite_exchange", maxAttempts: 6, windowMs: 60_000, blockMs: 5 * 60_000 } as const;
const SESSION_RATE_LIMIT = { scope: "session_mutation", maxAttempts: 24, windowMs: 60_000, blockMs: 60_000 } as const;

export type BeautyMovementCampaignStatus = "draft" | "active" | "disabled" | "closed";

export type BeautyMovementCardValidator = (params: {
    palette: BeautyMovementPalette;
    actIndex: number;
    cardId: string;
}) => boolean | Promise<boolean>;

type D1RunResult = {
    success?: boolean;
    meta?: { changes?: number };
};

export type BeautyMovementPreparedStatement = {
    bind: (...values: unknown[]) => BeautyMovementPreparedStatement;
    first: <T = unknown>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    run: () => Promise<D1RunResult | unknown>;
};

export type BeautyMovementD1 = {
    prepare: (query: string) => BeautyMovementPreparedStatement;
};

type CloudflareEnv = {
    BEAUTY_MOVEMENT_DB?: BeautyMovementD1;
    BEAUTY_MOVEMENT_ENABLED?: string | boolean;
};

type CampaignRow = {
    campaign_id: string;
    campaign_status: BeautyMovementCampaignStatus;
    campaign_starts_at_ms: number | null;
    campaign_ends_at_ms: number;
    campaign_title: string;
    campaign_description: string;
    campaign_invitation_title: string;
    campaign_invitation_text: string;
    campaign_partner_name: string;
    campaign_whatsapp_message_courtesy: string;
    campaign_whatsapp_message_commercial: string;
    campaign_whatsapp_label: string;
    campaign_conditions_label: string;
    campaign_conditions_text: string;
    campaign_velocity_benefit_label: string;
    campaign_velocity_benefit_text: string;
};

type InviteRow = CampaignRow & {
    invite_id: string;
    invite_status: BeautyMovementInviteStatus;
    invite_expires_at_ms: number;
    personal_data_version: number;
    personal_data_ciphertext: string;
    personal_data_iv: string;
    contact_mask: string;
    palette: BeautyMovementPalette;
    reward_id: string | null;
    outcome_key: BeautyMovementOutcomeKey | null;
    outcome_snapshot_json: string | null;
    outcome_protocol_version: string | null;
    outcome_resolved_at_ms: number | null;
    velocity_benefit: BeautyMovementVelocityBenefit;
    benefit_status: BeautyMovementBenefitStatus;
    benefit_text: string;
    benefit_validity: string;
    benefit_rules: string;
    terms_version: string;
    reward_type: BeautyMovementRewardType | null;
    reward_procedure_name: string | null;
    reward_discount_kind: BeautyMovementDiscountKind | null;
    reward_discount_value: number | null;
    reward_discount_currency: string | null;
    reward_display_text: string | null;
    reward_validity: string | null;
    reward_rules: string | null;
    reward_terms_version: string | null;
    operational_consent_at_ms: number | null;
    confirmed_at_ms: number | null;
};

type SessionInviteRow = InviteRow & {
    session_id: string;
    session_expires_at_ms: number;
    session_revoked_at_ms: number | null;
};

type RevealRow = {
    act_index: number;
    card_id: string;
    created_at_ms: number;
};

type RateLimitRow = {
    window_started_at_ms: number;
    attempt_count: number;
    blocked_until_ms: number | null;
};

type PersonalData = {
    name?: string;
    whatsapp?: string;
    email?: string | null;
};

export type BeautyMovementPublicState = {
    invite: {
        /** First name only. Raw contact data is never returned. */
        displayName: string;
        maskedWhatsapp: string;
        /** Presence only; the underlying address never reaches the browser. */
        emailRegistered: boolean;
    };
    palette: BeautyMovementPalette;
    /** Structured offer resolved from the persisted three-card reading. */
    offer: BeautyMovementOffer | null;
    /** @deprecated Compatibility field for old clients; new outcomes use offer. */
    benefit: BeautyMovementPublicReward | null;
    velocity: BeautyMovementPublicVelocity | null;
    reveals: Array<{ actIndex: number; cardId: string }>;
    confirmed: boolean;
    campaign: {
        title: string;
        description: string;
        invitationTitle: string;
        invitationText: string;
        partnerName: string;
        whatsappMessage: string;
        whatsappLabel: string;
        conditionsLabel: string;
        /** Available only after confirmation; it is campaign configuration, never personal data. */
        conditionsText: string | null;
    };
};

export type BeautyMovementPublicReward = {
    type: BeautyMovementRewardType;
    procedureName: string;
    discount: {
        kind: BeautyMovementDiscountKind;
        value: number;
        currency: "BRL";
    } | null;
    displayText: string;
    validity: string;
    rules: string;
    termsVersion: string;
};

export type BeautyMovementPublicVelocity = {
    enabled: true;
    label: string;
    text: string;
};

type BeautyMovementCampaignView = Omit<BeautyMovementPublicState["campaign"], "whatsappMessage" | "conditionsText"> & {
    whatsappMessageCourtesy: string;
    whatsappMessageCommercial: string;
    velocityBenefitLabel: string;
    velocityBenefitText: string;
};

export type BeautyMovementError =
    | "campaign_unavailable"
    | "invite_unavailable"
    | "session_unavailable"
    | "origin_not_allowed"
    | "rate_limited"
    | "card_catalog_unavailable"
    | "invalid_act"
    | "invalid_card"
    | "card_already_revealed"
    | "confirmation_requires_three_cards"
    | "operational_consent_required"
    | "invalid_email"
    | "email_update_not_allowed";

export type BeautyMovementStateResult =
    | { ok: true; state: BeautyMovementPublicState; replay?: boolean }
    | { ok: false; error: BeautyMovementError };

/** The raw session token is server-only and must be put into the HttpOnly cookie, never JSON. */
export type BeautyMovementExchangeResult =
    | {
        ok: true;
        /** Server-only: use solely to set the HttpOnly cookie, never serialize it. */
        sessionToken: string;
        /** Server-only: bounded by invite, campaign and session TTL. */
        sessionExpiresAtMs: number;
        state: BeautyMovementPublicState;
        replay?: boolean;
    }
    | { ok: false; error: BeautyMovementError };

export type BeautyMovementOperationOptions = {
    db?: BeautyMovementD1;
    /** Test-only / controlled server override. Runtime defaults fail closed. */
    enabled?: boolean;
    tokenHmacKey?: string;
    piiKey?: string;
    allowedOrigins?: readonly string[];
    cardValidator?: BeautyMovementCardValidator;
    nowMs?: number;
};

export async function getBeautyMovementDb(): Promise<BeautyMovementD1> {
    const context = await getCloudflareContext({ async: true });
    const db = (context.env as CloudflareEnv | undefined)?.BEAUTY_MOVEMENT_DB;
    if (!db) throw new Error("beauty_movement_db_unconfigured");
    return db;
}

async function isBeautyMovementEnabled(options: BeautyMovementOperationOptions): Promise<boolean> {
    if (typeof options.enabled === "boolean") return options.enabled;
    try {
        const context = await getCloudflareContext({ async: true });
        const value = (context.env as CloudflareEnv | undefined)?.BEAUTY_MOVEMENT_ENABLED;
        return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
    } catch {
        return false;
    }
}

function cleanText(value: unknown, maxLength: number): string {
    if (typeof value !== "string") return "";
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxLength ? normalized : "";
}

function normalizeOptionalEmail(value: string | null | undefined): string | null | "invalid" {
    const email = (value ?? "").trim().toLowerCase();
    if (!email) return null;
    if (email.length > 254 || /[\s\u0000-\u001F\u007F]/.test(email)) return "invalid";
    const at = email.indexOf("@");
    const domain = email.slice(at + 1);
    if (at <= 0 || at !== email.lastIndexOf("@") || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
        return "invalid";
    }
    return email;
}

function displayName(value: string | undefined): string {
    const first = cleanText(value, 160).split(/\s+/, 1)[0] ?? "";
    return first || "Participante";
}

function renderCampaign(row: CampaignRow): BeautyMovementCampaignView | null {
    const campaign = {
        title: cleanText(row.campaign_title, 160),
        description: cleanText(row.campaign_description, 500),
        invitationTitle: cleanText(row.campaign_invitation_title, 160),
        invitationText: cleanText(row.campaign_invitation_text, 600),
        partnerName: cleanText(row.campaign_partner_name, 120),
        whatsappMessageCourtesy: cleanText(row.campaign_whatsapp_message_courtesy, 1000),
        whatsappMessageCommercial: cleanText(row.campaign_whatsapp_message_commercial, 1000),
        whatsappLabel: cleanText(row.campaign_whatsapp_label, 120),
        conditionsLabel: cleanText(row.campaign_conditions_label, 120),
        velocityBenefitLabel: cleanText(row.campaign_velocity_benefit_label, 120),
        velocityBenefitText: cleanText(row.campaign_velocity_benefit_text, 500),
    };
    return Object.values(campaign).every(Boolean) ? campaign : null;
}

function campaignIsAvailable(row: CampaignRow, nowMs: number): boolean {
    return row.campaign_status === "active" &&
        (row.campaign_starts_at_ms === null || row.campaign_starts_at_ms <= nowMs) &&
        row.campaign_ends_at_ms > nowMs &&
        Boolean(renderCampaign(row));
}

function inviteIsAvailable(row: InviteRow, nowMs: number): boolean {
    return campaignIsAvailable(row, nowMs) && row.invite_status === "active" && row.invite_expires_at_ms > nowMs;
}

function asRunMeta(result: D1RunResult | unknown): number {
    if (!result || typeof result !== "object") return 0;
    const meta = (result as D1RunResult).meta;
    return Number(meta?.changes ?? 0);
}

async function resolveDb(options: BeautyMovementOperationOptions): Promise<BeautyMovementD1> {
    return options.db ?? getBeautyMovementDb();
}

async function resolveTokenHmacKey(options: BeautyMovementOperationOptions): Promise<string> {
    const key = (options.tokenHmacKey ?? await getRuntimeSecret("BEAUTY_MOVEMENT_TOKEN_HMAC_KEY")).trim();
    if (!key) throw new Error("beauty_movement_token_key_unavailable");
    return key;
}

async function resolvePiiKey(options: BeautyMovementOperationOptions): Promise<string> {
    const key = (options.piiKey ?? await getRuntimeSecret("BEAUTY_MOVEMENT_PII_KEY")).trim();
    if (!key) throw new Error("beauty_movement_pii_key_unavailable");
    return key;
}

function now(options: BeautyMovementOperationOptions): number {
    const candidate = options.nowMs ?? Date.now();
    return Number.isFinite(candidate) ? candidate : Date.now();
}

function fail(error: BeautyMovementError): BeautyMovementStateResult {
    return { ok: false, error };
}

function failExchange(error: BeautyMovementError): BeautyMovementExchangeResult {
    return { ok: false, error };
}

async function assertOrigin(origin: string | null | undefined, options: BeautyMovementOperationOptions): Promise<boolean> {
    return isBeautyMovementOriginAllowed(
        origin,
        options.allowedOrigins ?? await resolveBeautyMovementAllowedOriginsAtRuntime(),
    );
}

function sessionExpiry(row: InviteRow, nowMs: number): number {
    return Math.min(row.invite_expires_at_ms, row.campaign_ends_at_ms, nowMs + BEAUTY_MOVEMENT_SESSION_TTL_MS);
}

async function enforceRateLimit(params: {
    db: BeautyMovementD1;
    scope: string;
    subjectHmac: string;
    maxAttempts: number;
    windowMs: number;
    blockMs: number;
    nowMs: number;
}): Promise<boolean> {
    const maxAttempts = Math.floor(params.maxAttempts);
    const windowStartedResetThreshold = params.nowMs - params.windowMs;
    const blockUntilMs = params.nowMs + params.blockMs;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(windowStartedResetThreshold) || !Number.isSafeInteger(blockUntilMs)) {
        return false;
    }

    // Keep the state transition in one SQLite statement. A read-then-write
    // counter permits parallel requests to all observe the same attempt count.
    // Policy numbers are emitted as validated SQL literals so the statement
    // stays within the small, stable D1 binding set used by the Worker runtime.
    await params.db
        .prepare(
            `INSERT INTO bm_rate_limit_windows (
                scope, subject_hmac, window_started_at_ms, attempt_count, blocked_until_ms, updated_at_ms
             ) VALUES (?, ?, ?, 1, NULL, ?)
             ON CONFLICT(scope, subject_hmac) DO UPDATE SET
                window_started_at_ms = CASE
                    WHEN bm_rate_limit_windows.blocked_until_ms > ? THEN bm_rate_limit_windows.window_started_at_ms
                    WHEN bm_rate_limit_windows.window_started_at_ms <= ? THEN ?
                    ELSE bm_rate_limit_windows.window_started_at_ms
                END,
                attempt_count = CASE
                    WHEN bm_rate_limit_windows.blocked_until_ms > ? THEN bm_rate_limit_windows.attempt_count
                    WHEN bm_rate_limit_windows.window_started_at_ms <= ? THEN 1
                    ELSE bm_rate_limit_windows.attempt_count + 1
                END,
                blocked_until_ms = CASE
                    WHEN bm_rate_limit_windows.blocked_until_ms > ? THEN bm_rate_limit_windows.blocked_until_ms
                    WHEN (CASE
                        WHEN bm_rate_limit_windows.window_started_at_ms <= ? THEN 1
                        ELSE bm_rate_limit_windows.attempt_count + 1
                    END) > ${maxAttempts} THEN ?
                    ELSE NULL
                END,
                updated_at_ms = ?`,
        )
        .bind(
            params.scope,
            params.subjectHmac,
            params.nowMs,
            params.nowMs,
            params.nowMs,
            windowStartedResetThreshold,
            params.nowMs,
            params.nowMs,
            windowStartedResetThreshold,
            params.nowMs,
            windowStartedResetThreshold,
            blockUntilMs,
            params.nowMs,
        )
        .run();
    const persisted = await params.db
        .prepare(
            `SELECT window_started_at_ms, attempt_count, blocked_until_ms
             FROM bm_rate_limit_windows
             WHERE scope = ? AND subject_hmac = ?
             LIMIT 1`,
        )
        .bind(params.scope, params.subjectHmac)
        .first<RateLimitRow>();
    return Boolean(persisted && (!persisted.blocked_until_ms || persisted.blocked_until_ms <= params.nowMs));
}

async function enforceRateLimits(params: Omit<Parameters<typeof enforceRateLimit>[0], "subjectHmac"> & {
    subjectHmacs: readonly string[];
}): Promise<boolean> {
    const subjects = [...new Set(params.subjectHmacs.filter(Boolean))];
    if (subjects.length === 0) return false;
    for (const subjectHmac of subjects) {
        if (!(await enforceRateLimit({ ...params, subjectHmac }))) return false;
    }
    return true;
}

async function findInviteByTokenHash(db: BeautyMovementD1, tokenHash: string): Promise<InviteRow | null> {
    return db
        .prepare(
            `SELECT
                i.id AS invite_id, i.invite_status, i.expires_at_ms AS invite_expires_at_ms,
                i.personal_data_version, i.personal_data_ciphertext, i.personal_data_iv, i.contact_mask,
                i.palette, i.reward_id, i.outcome_key, i.outcome_snapshot_json, i.outcome_protocol_version, i.outcome_resolved_at_ms, i.velocity_benefit,
                i.benefit_status, i.benefit_text, i.benefit_validity, i.benefit_rules, i.terms_version,
                r.reward_type, r.procedure_name AS reward_procedure_name,
                r.discount_kind AS reward_discount_kind, r.discount_value AS reward_discount_value,
                r.discount_currency AS reward_discount_currency, r.display_text AS reward_display_text,
                r.validity AS reward_validity, r.rules AS reward_rules, r.terms_version AS reward_terms_version,
                i.operational_consent_at_ms, i.confirmed_at_ms,
                c.id AS campaign_id, c.status AS campaign_status, c.starts_at_ms AS campaign_starts_at_ms,
                c.ends_at_ms AS campaign_ends_at_ms, c.title AS campaign_title, c.description AS campaign_description,
                c.invitation_title AS campaign_invitation_title, c.invitation_text AS campaign_invitation_text,
                c.partner_name AS campaign_partner_name,
                c.whatsapp_message_courtesy AS campaign_whatsapp_message_courtesy,
                c.whatsapp_message_commercial AS campaign_whatsapp_message_commercial,
                c.whatsapp_label AS campaign_whatsapp_label, c.conditions_label AS campaign_conditions_label,
                c.conditions_text AS campaign_conditions_text,
                c.velocity_benefit_label AS campaign_velocity_benefit_label,
                c.velocity_benefit_text AS campaign_velocity_benefit_text
             FROM bm_invites i
             INNER JOIN bm_campaigns c ON c.id = i.campaign_id
             LEFT JOIN bm_rewards r ON r.campaign_id = i.campaign_id AND r.reward_id = i.reward_id
             WHERE i.invite_token_hmac = ?
             LIMIT 1`,
        )
        .bind(tokenHash)
        .first<InviteRow>();
}

async function findSessionByTokenHash(db: BeautyMovementD1, tokenHash: string): Promise<SessionInviteRow | null> {
    return db
        .prepare(
            `SELECT
                s.id AS session_id, s.expires_at_ms AS session_expires_at_ms, s.revoked_at_ms AS session_revoked_at_ms,
                i.id AS invite_id, i.invite_status, i.expires_at_ms AS invite_expires_at_ms,
                i.personal_data_version, i.personal_data_ciphertext, i.personal_data_iv, i.contact_mask,
                i.palette, i.reward_id, i.outcome_key, i.outcome_snapshot_json, i.outcome_protocol_version, i.outcome_resolved_at_ms, i.velocity_benefit,
                i.benefit_status, i.benefit_text, i.benefit_validity, i.benefit_rules, i.terms_version,
                r.reward_type, r.procedure_name AS reward_procedure_name,
                r.discount_kind AS reward_discount_kind, r.discount_value AS reward_discount_value,
                r.discount_currency AS reward_discount_currency, r.display_text AS reward_display_text,
                r.validity AS reward_validity, r.rules AS reward_rules, r.terms_version AS reward_terms_version,
                i.operational_consent_at_ms, i.confirmed_at_ms,
                c.id AS campaign_id, c.status AS campaign_status, c.starts_at_ms AS campaign_starts_at_ms,
                c.ends_at_ms AS campaign_ends_at_ms, c.title AS campaign_title, c.description AS campaign_description,
                c.invitation_title AS campaign_invitation_title, c.invitation_text AS campaign_invitation_text,
                c.partner_name AS campaign_partner_name,
                c.whatsapp_message_courtesy AS campaign_whatsapp_message_courtesy,
                c.whatsapp_message_commercial AS campaign_whatsapp_message_commercial,
                c.whatsapp_label AS campaign_whatsapp_label, c.conditions_label AS campaign_conditions_label,
                c.conditions_text AS campaign_conditions_text,
                c.velocity_benefit_label AS campaign_velocity_benefit_label,
                c.velocity_benefit_text AS campaign_velocity_benefit_text
             FROM bm_sessions s
             INNER JOIN bm_invites i ON i.id = s.invite_id
             INNER JOIN bm_campaigns c ON c.id = i.campaign_id
             LEFT JOIN bm_rewards r ON r.campaign_id = i.campaign_id AND r.reward_id = i.reward_id
             WHERE s.session_token_hmac = ?
             LIMIT 1`,
        )
        .bind(tokenHash)
        .first<SessionInviteRow>();
}

async function listReveals(db: BeautyMovementD1, inviteId: string): Promise<RevealRow[]> {
    const result = await db
        .prepare(
            `SELECT act_index, card_id, created_at_ms
             FROM bm_card_reveals
             WHERE invite_id = ?
             ORDER BY act_index ASC`,
        )
        .bind(inviteId)
        .all<RevealRow>();
    return result.results ?? [];
}

function renderReward(row: InviteRow): BeautyMovementPublicReward | null {
    if (row.reward_type !== "free_procedure" && row.reward_type !== "discount") return null;
    const procedureName = cleanText(row.reward_procedure_name, 160);
    const displayText = cleanText(row.reward_display_text, 500);
    const validity = cleanText(row.reward_validity, 300);
    const rules = cleanText(row.reward_rules, 1200);
    const termsVersion = cleanText(row.reward_terms_version, 120);
    if (!procedureName || !displayText || !validity || !rules || !termsVersion) return null;

    if (row.reward_type === "free_procedure") {
        return {
            type: row.reward_type,
            procedureName,
            discount: null,
            displayText,
            validity,
            rules,
            termsVersion,
        };
    }

    if (row.reward_discount_kind !== "percent" && row.reward_discount_kind !== "fixed") return null;
    const discountValue = Number(row.reward_discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0 || row.reward_discount_currency !== "BRL") return null;
    if (row.reward_discount_kind === "percent" && discountValue > 100) return null;
    return {
        type: row.reward_type,
        procedureName,
        discount: { kind: row.reward_discount_kind, value: discountValue, currency: "BRL" },
        displayText,
        validity,
        rules,
        termsVersion,
    };
}

function renderStoredOffer(row: InviteRow): BeautyMovementOffer | null {
    if (!row.outcome_key || !BEAUTY_MOVEMENT_OUTCOME_KEYS.includes(row.outcome_key)) return null;
    if (row.outcome_protocol_version !== BEAUTY_MOVEMENT_OUTCOME_PROTOCOL_VERSION) return null;
    const offer = getBeautyMovementOffer(row.outcome_key);
    if (!row.outcome_snapshot_json) return offer;
    try {
        const snapshot = JSON.parse(row.outcome_snapshot_json) as unknown;
        return JSON.stringify(snapshot) === JSON.stringify(offer) ? offer : null;
    } catch {
        return null;
    }
}

async function resolveAndPersistOutcome(params: {
    db: BeautyMovementD1;
    row: InviteRow;
    reveals: readonly RevealRow[];
    nowMs: number;
}): Promise<BeautyMovementOffer | null> {
    if (params.reveals.length !== 3) return null;
    const selections = {
        beleza: params.reveals.find((reveal) => reveal.act_index === 1)?.card_id,
        movimento: params.reveals.find((reveal) => reveal.act_index === 2)?.card_id,
        celebracao: params.reveals.find((reveal) => reveal.act_index === 3)?.card_id,
    } as const;
    const resolved = resolveBeautyMovementOutcome({ palette: params.row.palette, selections });
    const snapshot = JSON.stringify(resolved.offer);
    if (params.row.outcome_key) {
        if (
            params.row.outcome_key !== resolved.outcomeKey ||
            params.row.outcome_protocol_version !== resolved.protocolVersion ||
            (params.row.outcome_snapshot_json && params.row.outcome_snapshot_json !== snapshot)
        ) {
            throw new Error("beauty_movement_outcome_mismatch");
        }
        return resolved.offer;
    }
    await params.db
        .prepare(
            `UPDATE bm_invites
             SET outcome_key = COALESCE(outcome_key, ?),
                 outcome_snapshot_json = COALESCE(outcome_snapshot_json, ?),
                 outcome_protocol_version = COALESCE(outcome_protocol_version, ?),
                 outcome_resolved_at_ms = COALESCE(outcome_resolved_at_ms, ?),
                 updated_at_ms = ?
             WHERE id = ? AND outcome_key IS NULL`,
        )
        .bind(resolved.outcomeKey, snapshot, resolved.protocolVersion, params.nowMs, params.nowMs, params.row.invite_id)
        .run();
    return resolved.offer;
}

async function publicState(params: {
    db: BeautyMovementD1;
    row: InviteRow;
    piiKey: string;
}): Promise<BeautyMovementPublicState | null> {
    const campaign = renderCampaign(params.row);
    if (!campaign || params.row.personal_data_version !== 1) return null;
    const personal = await decryptBeautyMovementPersonalData<PersonalData>({
        version: 1,
        ciphertext: params.row.personal_data_ciphertext,
        iv: params.row.personal_data_iv,
    } satisfies BeautyMovementEncryptedPersonalData, params.piiKey);
    const reveals = await listReveals(params.db, params.row.invite_id);
    const confirmed = params.row.confirmed_at_ms !== null;
    const { whatsappMessageCourtesy, whatsappMessageCommercial, velocityBenefitLabel, velocityBenefitText, ...campaignView } = campaign;
    const configuredReward = renderReward(params.row);
    const offer = confirmed ? renderStoredOffer(params.row) : null;
    if (confirmed && params.row.outcome_key && !offer) return null;
    const reward = confirmed && !offer && !params.row.outcome_key ? configuredReward : null;
    const conditionsParts = confirmed
        ? [
            cleanText(params.row.campaign_conditions_text, 1600),
            offer?.commercialText ?? "",
            ...(offer?.externalRules ?? []),
            reward?.validity ?? cleanText(params.row.benefit_validity, 300),
            reward?.rules ?? cleanText(params.row.benefit_rules, 1200),
        ].filter(Boolean)
        : [];
    return {
        invite: {
            displayName: displayName(personal.name),
            maskedWhatsapp: cleanText(params.row.contact_mask, 80) || "Contato confirmado",
            emailRegistered: Boolean(personal.email),
        },
        palette: params.row.palette,
        offer,
        benefit: reward,
        velocity: confirmed && params.row.velocity_benefit === "aula_cortesia_evento" && velocityBenefitLabel && velocityBenefitText
            ? { enabled: true, label: velocityBenefitLabel, text: velocityBenefitText }
            : null,
        reveals: reveals.map((reveal) => ({ actIndex: reveal.act_index, cardId: reveal.card_id })),
        confirmed,
        campaign: {
            ...campaignView,
            whatsappMessage: !offer && params.row.benefit_status === "aula_cortesia_evento" && !params.row.reward_id
                ? whatsappMessageCourtesy
                : whatsappMessageCommercial,
            conditionsText: conditionsParts.length ? conditionsParts.join("\n\n") : null,
        },
    };
}

async function loadActiveSession(params: {
    sessionToken: string | null | undefined;
    options: BeautyMovementOperationOptions;
}): Promise<
    | { ok: true; db: BeautyMovementD1; tokenKey: string; piiKey: string; row: SessionInviteRow; sessionTokenHash: string; nowMs: number }
    | { ok: false; result: BeautyMovementStateResult }
> {
    if (!isBeautyMovementOpaqueToken(params.sessionToken)) return { ok: false, result: fail("session_unavailable") };
    if (!(await isBeautyMovementEnabled(params.options))) return { ok: false, result: fail("campaign_unavailable") };
    try {
        const [db, tokenKey, piiKey] = await Promise.all([
            resolveDb(params.options),
            resolveTokenHmacKey(params.options),
            resolvePiiKey(params.options),
        ]);
        const sessionTokenHash = await hashBeautyMovementSessionToken({ secret: tokenKey, token: params.sessionToken });
        const row = await findSessionByTokenHash(db, sessionTokenHash);
        const nowMs = now(params.options);
        if (!row || row.session_revoked_at_ms !== null || row.session_expires_at_ms <= nowMs || !inviteIsAvailable(row, nowMs)) {
            return { ok: false, result: fail("session_unavailable") };
        }
        return { ok: true, db, tokenKey, piiKey, row, sessionTokenHash, nowMs };
    } catch {
        return { ok: false, result: fail("campaign_unavailable") };
    }
}

export async function getBeautyMovementSession(
    cookie: string | null | undefined,
    options: BeautyMovementOperationOptions = {},
): Promise<BeautyMovementStateResult> {
    const loaded = await loadActiveSession({ sessionToken: cookie, options });
    if (!loaded.ok) return loaded.result;
    try {
        const state = await publicState({ db: loaded.db, row: loaded.row, piiKey: loaded.piiKey });
        if (!state) return fail("campaign_unavailable");
        await loaded.db
            .prepare("UPDATE bm_sessions SET last_seen_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL")
            .bind(loaded.nowMs, loaded.row.session_id)
            .run();
        return { ok: true, state };
    } catch {
        return fail("campaign_unavailable");
    }
}

export async function exchangeBeautyMovementInvite(params: {
    token: string;
    origin: string | null | undefined;
    ip: string | null | undefined;
    nowMs?: number;
}, options: BeautyMovementOperationOptions = {}): Promise<BeautyMovementExchangeResult> {
    if (!(await isBeautyMovementEnabled(options))) return failExchange("campaign_unavailable");
    if (!(await assertOrigin(params.origin, options))) return failExchange("origin_not_allowed");
    if (!isBeautyMovementOpaqueToken(params.token)) return failExchange("invite_unavailable");
    const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : now(options);

    try {
        const [db, tokenKey, piiKey] = await Promise.all([
            resolveDb(options),
            resolveTokenHmacKey(options),
            resolvePiiKey(options),
        ]);
        const ipHash = await hashBeautyMovementIp({ secret: tokenKey, ip: params.ip ?? "unknown" });
        // Always apply the IP limiter before deriving a token-scoped state.
        // Otherwise a blocked caller can create an unbounded D1 row for every
        // syntactically valid random token it submits.
        if (ipHash && !(await enforceRateLimit({
            db,
            subjectHmac: `ip:${ipHash}`,
            nowMs,
            ...EXCHANGE_RATE_LIMIT,
        }))) return failExchange("rate_limited");
        const inviteTokenHash = await hashBeautyMovementInviteToken({ secret: tokenKey, token: params.token });
        const row = await findInviteByTokenHash(db, inviteTokenHash);
        if (!row || !inviteIsAvailable(row, nowMs)) return failExchange("invite_unavailable");
        if (!(await enforceRateLimit({
            db,
            subjectHmac: `invite:${inviteTokenHash}`,
            nowMs,
            ...EXCHANGE_RATE_LIMIT,
        }))) return failExchange("rate_limited");

        const sessionToken = createBeautyMovementOpaqueToken();
        const sessionTokenHash = await hashBeautyMovementSessionToken({ secret: tokenKey, token: sessionToken });
        const sessionExpiresAtMs = sessionExpiry(row, nowMs);
        await db
            .prepare(
                `INSERT INTO bm_sessions (
                    id, invite_id, session_token_hmac, client_ip_hmac, expires_at_ms, created_at_ms, last_seen_at_ms, revoked_at_ms
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            )
            .bind(crypto.randomUUID(), row.invite_id, sessionTokenHash, ipHash, sessionExpiresAtMs, nowMs, nowMs)
            .run();
        const state = await publicState({ db, row, piiKey });
        if (!state) return failExchange("campaign_unavailable");
        return { ok: true, sessionToken, sessionExpiresAtMs, state };
    } catch {
        return failExchange("campaign_unavailable");
    }
}

export async function revealBeautyMovementCard(params: {
    sessionToken: string | null | undefined;
    actIndex: number;
    cardId: string;
    origin: string | null | undefined;
    ip: string | null | undefined;
}, options: BeautyMovementOperationOptions = {}): Promise<BeautyMovementStateResult> {
    if (!(await assertOrigin(params.origin, options))) return fail("origin_not_allowed");
    if (!Number.isInteger(params.actIndex) || params.actIndex < 1 || params.actIndex > 3) return fail("invalid_act");
    const cardId = cleanText(params.cardId, 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(cardId)) return fail("invalid_card");
    if (!options.cardValidator) return fail("card_catalog_unavailable");

    const loaded = await loadActiveSession({ sessionToken: params.sessionToken, options });
    if (!loaded.ok) return loaded.result;
    try {
        const ipHash = await hashBeautyMovementIp({ secret: loaded.tokenKey, ip: params.ip ?? "unknown" });
        if (!(await enforceRateLimits({
            db: loaded.db,
            subjectHmacs: [
                `session:${loaded.sessionTokenHash}`,
                ...(ipHash ? [`ip:${ipHash}`] : []),
            ],
            nowMs: loaded.nowMs,
            ...SESSION_RATE_LIMIT,
        }))) {
            return fail("rate_limited");
        }
        if (loaded.row.confirmed_at_ms !== null) return fail("card_already_revealed");
        const reveals = await listReveals(loaded.db, loaded.row.invite_id);
        const current = reveals.find((reveal) => reveal.act_index === params.actIndex);
        if (current) {
            if (current.card_id !== cardId) return fail("card_already_revealed");
            await resolveAndPersistOutcome({ db: loaded.db, row: loaded.row, reveals, nowMs: loaded.nowMs });
            const refreshed = reveals.length === 3
                ? await findSessionByTokenHash(loaded.db, loaded.sessionTokenHash)
                : loaded.row;
            const state = refreshed
                ? await publicState({ db: loaded.db, row: refreshed, piiKey: loaded.piiKey })
                : null;
            return state ? { ok: true, state, replay: true } : fail("campaign_unavailable");
        }
        if (params.actIndex !== reveals.length + 1) return fail("invalid_act");
        if (!(await options.cardValidator({ palette: loaded.row.palette, actIndex: params.actIndex, cardId }))) {
            return fail("invalid_card");
        }
        const result = await loaded.db
            .prepare(
                `INSERT INTO bm_card_reveals (invite_id, act_index, card_id, created_at_ms)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(invite_id, act_index) DO NOTHING`,
            )
            .bind(loaded.row.invite_id, params.actIndex, cardId, loaded.nowMs)
            .run();
        if (asRunMeta(result) === 0) {
            const persisted = (await listReveals(loaded.db, loaded.row.invite_id)).find((reveal) => reveal.act_index === params.actIndex);
            if (!persisted || persisted.card_id !== cardId) return fail("card_already_revealed");
        }
        const revealsAfterWrite = await listReveals(loaded.db, loaded.row.invite_id);
        await resolveAndPersistOutcome({ db: loaded.db, row: loaded.row, reveals: revealsAfterWrite, nowMs: loaded.nowMs });
        const refreshed = revealsAfterWrite.length === 3
            ? await findSessionByTokenHash(loaded.db, loaded.sessionTokenHash)
            : loaded.row;
        const state = refreshed
            ? await publicState({ db: loaded.db, row: refreshed, piiKey: loaded.piiKey })
            : null;
        return state ? { ok: true, state } : fail("campaign_unavailable");
    } catch {
        return fail("campaign_unavailable");
    }
}

export async function confirmBeautyMovementInvite(params: {
    sessionToken: string | null | undefined;
    email?: string | null;
    operationalConsent: boolean;
    origin: string | null | undefined;
    ip: string | null | undefined;
}, options: BeautyMovementOperationOptions = {}): Promise<BeautyMovementStateResult> {
    if (!(await assertOrigin(params.origin, options))) return fail("origin_not_allowed");
    const email = normalizeOptionalEmail(params.email);
    if (email === "invalid") return fail("invalid_email");

    const loaded = await loadActiveSession({ sessionToken: params.sessionToken, options });
    if (!loaded.ok) return loaded.result;
    try {
        const ipHash = await hashBeautyMovementIp({ secret: loaded.tokenKey, ip: params.ip ?? "unknown" });
        if (!(await enforceRateLimits({
            db: loaded.db,
            subjectHmacs: [
                `session:${loaded.sessionTokenHash}`,
                ...(ipHash ? [`ip:${ipHash}`] : []),
            ],
            nowMs: loaded.nowMs,
            ...SESSION_RATE_LIMIT,
        }))) {
            return fail("rate_limited");
        }
        if (loaded.row.confirmed_at_ms !== null) {
            const state = await publicState({ db: loaded.db, row: loaded.row, piiKey: loaded.piiKey });
            return state ? { ok: true, state, replay: true } : fail("campaign_unavailable");
        }
        const reveals = await listReveals(loaded.db, loaded.row.invite_id);
        if (reveals.length !== 3) return fail("confirmation_requires_three_cards");
        if (!params.operationalConsent) return fail("operational_consent_required");
        await resolveAndPersistOutcome({ db: loaded.db, row: loaded.row, reveals, nowMs: loaded.nowMs });

        let encrypted: BeautyMovementEncryptedPersonalData | null = null;
        if (email) {
            const personal = await decryptBeautyMovementPersonalData<PersonalData>({
                version: 1,
                ciphertext: loaded.row.personal_data_ciphertext,
                iv: loaded.row.personal_data_iv,
            }, loaded.piiKey);
            if (personal.email && personal.email !== email) return fail("email_update_not_allowed");
            if (!personal.email) {
                encrypted = await encryptBeautyMovementPersonalData({
                    name: personal.name ?? "",
                    whatsapp: personal.whatsapp ?? "",
                    email,
                }, loaded.piiKey);
            }
        }

        // A conditional claim makes confirmation idempotent even when two tabs
        // reach this point after reading the same unconfirmed invite. In
        // particular, the losing request must not overwrite a newly supplied
        // e-mail ciphertext from the winning request.
        const confirmationClaim = encrypted
            ? await loaded.db
                .prepare(
                    `UPDATE bm_invites
                     SET personal_data_version = 1,
                         personal_data_ciphertext = ?,
                         personal_data_iv = ?,
                         operational_consent_at_ms = COALESCE(operational_consent_at_ms, ?),
                         confirmed_at_ms = COALESCE(confirmed_at_ms, ?),
                         updated_at_ms = ?
                     WHERE id = ? AND confirmed_at_ms IS NULL`,
                )
                .bind(encrypted.ciphertext, encrypted.iv, loaded.nowMs, loaded.nowMs, loaded.nowMs, loaded.row.invite_id)
                .run()
            : await loaded.db
                .prepare(
                    `UPDATE bm_invites
                     SET operational_consent_at_ms = COALESCE(operational_consent_at_ms, ?),
                         confirmed_at_ms = COALESCE(confirmed_at_ms, ?),
                         updated_at_ms = ?
                     WHERE id = ? AND confirmed_at_ms IS NULL`,
                )
                .bind(loaded.nowMs, loaded.nowMs, loaded.nowMs, loaded.row.invite_id)
                .run();

        const refreshed = await findSessionByTokenHash(loaded.db, loaded.sessionTokenHash);
        if (!refreshed || !inviteIsAvailable(refreshed, loaded.nowMs)) return fail("session_unavailable");
        const state = await publicState({ db: loaded.db, row: refreshed, piiKey: loaded.piiKey });
        if (!state) return fail("campaign_unavailable");
        return asRunMeta(confirmationClaim) > 0
            ? { ok: true, state }
            : { ok: true, state, replay: true };
    } catch {
        return fail("campaign_unavailable");
    }
}
