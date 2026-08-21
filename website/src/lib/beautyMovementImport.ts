import {
    deriveBeautyMovementInviteToken,
    encryptBeautyMovementPersonalData,
    hashBeautyMovementInviteToken,
    maskBeautyMovementContact,
} from "@/lib/beautyMovementSecurity";
import {
    validateBeautyMovementRewardCatalog,
    type BeautyMovementCanonicalProcedure,
    type BeautyMovementRewardCatalogEntry,
    type BeautyMovementValidatedReward,
    type BeautyMovementVelocityBenefit,
} from "@/lib/beautyMovementRewards";
import {
    getBeautyMovementOffer,
    selectBeautyMovementPlannedSelections,
} from "@/lib/beautyMovementOutcomes";
import type { BeautyMovementOutcomeKey } from "@/lib/beautyMovementOutcomes";

export type {
    BeautyMovementCanonicalProcedure,
    BeautyMovementDiscount,
    BeautyMovementDiscountKind,
    BeautyMovementRewardCatalogEntry,
    BeautyMovementRewardType,
    BeautyMovementVelocityBenefit,
} from "@/lib/beautyMovementRewards";

export const BEAUTY_MOVEMENT_PALETTES = ["radiancia", "ritmo", "conexao"] as const;
/**
 * The compact sheet is the audience and its approved prize. The palette is an
 * internal deck-selection detail; it must never become a second commercial
 * decision or override the spreadsheet assignment.
 */
export const BEAUTY_MOVEMENT_COMPACT_VELOCITY_PALETTE = "radiancia" as const;
/**
 * These values are retained for legacy invitation columns. New sheet
 * invitations persist an explicit assignment protocol; only unassigned legacy
 * rows use the card-derived combination engine.
 */
export const BEAUTY_MOVEMENT_BENEFIT_STATUSES = ["aula_cortesia_evento", "evento_condicao_comercial"] as const;
export const BEAUTY_MOVEMENT_INVITE_STATUSES = ["active", "revoked"] as const;
export const BEAUTY_MOVEMENT_ASSIGNMENT_PROTOCOL_VERSION = "beauty-movement-invite-assignments-v1" as const;

export type BeautyMovementPalette = (typeof BEAUTY_MOVEMENT_PALETTES)[number];
export type BeautyMovementBenefitStatus = (typeof BEAUTY_MOVEMENT_BENEFIT_STATUSES)[number];
export type BeautyMovementInviteStatus = (typeof BEAUTY_MOVEMENT_INVITE_STATUSES)[number];

const REQUIRED_HEADERS = [
    "invite_ref",
    "name",
    "whatsapp",
    "palette",
    "velocity_benefit",
    "expires_at",
] as const;

const COMPACT_VELOCITY_REQUIRED_HEADERS = ["name", "whatsapp"] as const;
const OPTIONAL_HEADERS = ["email", "invite_status", "reward_id", "prize"] as const;
const ALLOWED_HEADERS = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]);
const HEADER_ALIASES: Readonly<Record<string, string>> = {
    nome: "name",
    telefone: "whatsapp",
    telefone_whatsapp: "whatsapp",
    premio: "prize",
    recompensa: "prize",
};
const FORBIDDEN_HEADERS = new Set([
    "cpf",
    "cpf_cnpj",
    "rg",
    "medical_history",
    "health_data",
    "diagnosis",
    "procedure",
    "procedures",
    "procedure_history",
    "historico_procedimentos",
    "historico_medico",
    "procedure_id",
    "procedure_name",
    "discount",
    "discount_percent",
    "discount_value",
    "benefit_text",
    "benefit_validity",
    "benefit_rules",
    "terms_version",
]);

const SENSITIVE_VALUE_TERMS = /\b(?:cpf|diagnostico|laudo|prontuario|procedimentos?|historico\s+(?:medico|clinico|de\s+procedimentos?)|doenca|comorbidade|medicacao)\b/i;

export type BeautyMovementImportIssueCode =
    | "invalid_csv"
    | "missing_header"
    | "duplicate_header"
    | "unknown_header"
    | "forbidden_header"
    | "column_count_mismatch"
    | "required_value_missing"
    | "invalid_invite_ref"
    | "duplicate_invite_ref"
    | "invalid_name"
    | "invalid_whatsapp"
    | "duplicate_whatsapp"
    | "invalid_email"
    | "duplicate_email"
    | "invalid_palette"
    | "invalid_reward_id"
    | "reward_not_found"
    | "reward_family_mismatch"
    | "invalid_velocity_benefit"
    | "unsupported_prize"
    | "invalid_invite_status"
    | "invalid_text"
    | "invalid_expiry"
    | "expired_invite"
    | "campaign_expiry_before_invite"
    | "missing_reward_catalog"
    | "compact_expiry_unavailable"
    | "prohibited_sensitive_value";

export type BeautyMovementImportIssue = {
    row: number | null;
    column: string | null;
    code: BeautyMovementImportIssueCode;
};

export type BeautyMovementImportRow = {
    inviteRef: string;
    sourceFormat: "full" | "compact_velocity";
    name: string;
    whatsapp: string;
    email: string | null;
    palette: BeautyMovementPalette;
    rewardId: string | null;
    /** Spreadsheet prize authority. Null means the invite is the Velocity courtesy outcome. */
    assignedOutcomeKey: BeautyMovementOutcomeKey | null;
    prizeAssigned: boolean;
    velocityBenefit: BeautyMovementVelocityBenefit;
    expiresAtMs: number;
    inviteStatus: BeautyMovementInviteStatus;
};

/**
 * Campaign copy lives in a private configuration file, not in the contact CSV
 * and not in source control. Keeping it here makes a list import capable of
 * producing a complete, auditable draft campaign without ever activating it.
 */
export type BeautyMovementCampaignConfig = {
    title: string;
    description: string;
    invitationTitle: string;
    invitationText: string;
    partnerName: string;
    whatsappMessageCourtesy: string;
    whatsappMessageCommercial: string;
    whatsappLabel: string;
    conditionsLabel: string;
    conditionsText: string;
    velocityBenefitLabel: string;
    velocityBenefitText: string;
    startsAtMs: number | null;
};

export type BeautyMovementCampaignConfigInput = Omit<BeautyMovementCampaignConfig, "startsAtMs"> & {
    startsAt?: string | null;
};

export type BeautyMovementImportValidation =
    | {
        ok: true;
        delimiter: "," | ";";
        rows: BeautyMovementImportRow[];
        sourceRowCount: number;
    }
    | {
        ok: false;
        delimiter: "," | ";" | null;
        rows: [];
        sourceRowCount: number;
        issues: BeautyMovementImportIssue[];
    };

export type BeautyMovementPreparedInvite = {
    id: string;
    inviteRef: string;
    inviteTokenHmac: string;
    personalDataCiphertext: string;
    personalDataIv: string;
    contactMask: string;
    palette: BeautyMovementPalette;
    rewardId: string | null;
    assignedOutcomeKey: BeautyMovementOutcomeKey | null;
    assignmentProtocolVersion: typeof BEAUTY_MOVEMENT_ASSIGNMENT_PROTOCOL_VERSION | null;
    plannedCardSelectionsJson: string;
    velocityBenefit: BeautyMovementVelocityBenefit;
    benefitStatus: BeautyMovementBenefitStatus;
    benefitText: string;
    benefitValidity: string;
    benefitRules: string;
    termsVersion: string;
    expiresAtMs: number;
    inviteStatus: BeautyMovementInviteStatus;
};

export type BeautyMovementDeliveryRow = {
    name: string;
    inviteRef: string;
    whatsapp: string;
    inviteUrl: string;
};

export type BeautyMovementPreparedImport = {
    campaignId: string;
    campaignConfig: BeautyMovementCampaignConfig;
    campaignEndsAtMs: number;
    inputSha256: string;
    sourceRowCount: number;
    createdAtMs: number;
    importRunId: string;
    rewards: BeautyMovementValidatedReward[];
    invites: BeautyMovementPreparedInvite[];
    deliveryRows: BeautyMovementDeliveryRow[];
};

function normalizedHeader(value: string): string {
    return value
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function cleanText(value: string | undefined, maxLength: number): string {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return "";
    return text;
}

function isValidCpfDigits(value: string): boolean {
    if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
    const checkDigit = (length: number) => {
        const total = value
            .slice(0, length)
            .split("")
            .reduce((sum, digit, index) => sum + Number(digit) * (length + 1 - index), 0);
        const remainder = (total * 10) % 11;
        return remainder === 10 ? 0 : remainder;
    };
    return checkDigit(9) === Number(value[9]) && checkDigit(10) === Number(value[10]);
}

/**
 * The input contract is a sanitised list, but this remains a second line of
 * defence against a CPF or health/procedure data accidentally pasted into a
 * free-text campaign field. It intentionally does not inspect the allowed
 * contact fields themselves.
 */
function containsProhibitedSensitiveValue(value: string): boolean {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (SENSITIVE_VALUE_TERMS.test(normalized)) return true;
    const cpfCandidates = normalized.match(/\d(?:[.\s-]?\d){10}/g) ?? [];
    return cpfCandidates.some((candidate) => isValidCpfDigits(candidate.replace(/\D/g, "")));
}

function normalizePhone(value: string | undefined): string {
    const digits = (value ?? "").replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
    if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
    return "";
}

function normalizeEmail(value: string | undefined): string | null {
    const email = (value ?? "").trim().toLowerCase();
    if (!email) return null;
    if (email.length > 254 || /[\s\u0000-\u001F\u007F]/.test(email)) return null;
    const at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return null;
    const domain = email.slice(at + 1);
    if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
    return email;
}

function parseStrictIsoDate(value: string | undefined): number | null {
    const text = (value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
        return null;
    }
    const milliseconds = Date.parse(text);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function requireCampaignText(value: unknown, maxLength: number): string {
    return typeof value === "string" ? cleanText(value, maxLength) : "";
}

/**
 * Validates the campaign-level copy separately from the sanitised invite CSV.
 * The returned data is safe for parameterised/escaped D1 configuration SQL,
 * but is never intended for public logging.
 */
export function validateBeautyMovementCampaignConfig(value: unknown): BeautyMovementCampaignConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("beauty_movement_campaign_config_invalid");
    }
    const source = value as Record<string, unknown>;
    const config = {
        title: requireCampaignText(source.title, 160),
        description: requireCampaignText(source.description, 500),
        invitationTitle: requireCampaignText(source.invitationTitle, 160),
        invitationText: requireCampaignText(source.invitationText, 600),
        partnerName: requireCampaignText(source.partnerName, 120),
        whatsappMessageCourtesy: requireCampaignText(source.whatsappMessageCourtesy, 1000),
        whatsappMessageCommercial: requireCampaignText(source.whatsappMessageCommercial, 1000),
        whatsappLabel: requireCampaignText(source.whatsappLabel, 120),
        conditionsLabel: requireCampaignText(source.conditionsLabel, 120),
        conditionsText: requireCampaignText(source.conditionsText, 1600),
        velocityBenefitLabel: requireCampaignText(source.velocityBenefitLabel, 120),
        velocityBenefitText: requireCampaignText(source.velocityBenefitText, 500),
    };
    if (!Object.values(config).every(Boolean)) {
        throw new Error("beauty_movement_campaign_config_invalid");
    }

    const startsAt = source.startsAt;
    if (startsAt === undefined || startsAt === null || startsAt === "") {
        return { ...config, startsAtMs: null };
    }
    if (typeof startsAt !== "string") throw new Error("beauty_movement_campaign_config_invalid");
    const startsAtMs = parseStrictIsoDate(startsAt);
    if (startsAtMs === null) throw new Error("beauty_movement_campaign_config_invalid");
    return { ...config, startsAtMs };
}

function asAllowed<T extends readonly string[]>(value: string, allowed: T): T[number] | null {
    return (allowed as readonly string[]).includes(value) ? value as T[number] : null;
}

const PRIZE_OUTCOME_ALIASES: Readonly<Record<string, BeautyMovementOutcomeKey>> = {
    firmeza_renovacao: "elleva_upgrade",
    elleva: "elleva_upgrade",
    harmonia_definicao: "filler_double",
    preenchimento: "filler_double",
    estrutura_estimulo: "sculptra_classic_unlock",
    restylane_classic_sculptra: "sculptra_classic_unlock",
    hidratacao_luminosidade: "skinbooster_diamond_unlock",
    restylane_skinbooster_diamond: "skinbooster_diamond_unlock",
};

function normalizePrize(value: string): BeautyMovementOutcomeKey | null | undefined {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!normalized || ["velocity", "aula_cortesia_velocity", "aula_cortesia_de_velocity", "aula_cortesia_evento"].includes(normalized)) {
        return null;
    }
    return PRIZE_OUTCOME_ALIASES[normalized];
}

function scanRecordDelimiter(line: string, delimiter: string): number {
    let quotes = false;
    let count = 0;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quotes && line[index + 1] === '"') {
                index += 1;
            } else {
                quotes = !quotes;
            }
        } else if (!quotes && char === delimiter) {
            count += 1;
        }
    }
    return count;
}

function detectDelimiter(source: string): "," | ";" {
    const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
    return scanRecordDelimiter(firstLine, ";") > scanRecordDelimiter(firstLine, ",") ? ";" : ",";
}

function parseDelimited(source: string, delimiter: "," | ";"): { rows: string[][]; error: boolean } {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (char === '"') {
                if (source[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            if (field.length > 0) return { rows: [], error: true };
            quoted = true;
            continue;
        }
        if (char === delimiter) {
            row.push(field);
            field = "";
            continue;
        }
        if (char === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
            continue;
        }
        field += char;
    }

    if (quoted) return { rows: [], error: true };
    if (field.length > 0 || row.length > 0) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }
    return { rows, error: false };
}

function issue(row: number | null, column: string | null, code: BeautyMovementImportIssueCode): BeautyMovementImportIssue {
    return { row, column, code };
}

function rowHasAnyValue(row: string[]): boolean {
    return row.some((cell) => cell.trim().length > 0);
}

export function validateBeautyMovementImport(params: {
    csv: string;
    rewardCatalog?: readonly BeautyMovementRewardCatalogEntry[];
    nowMs?: number;
    /** Required when the compact Velocity source omits its derived expiry. */
    defaultExpiresAtMs?: number;
}): BeautyMovementImportValidation {
    const delimiter = detectDelimiter(params.csv);
    const parsed = parseDelimited(params.csv, delimiter);
    if (parsed.error || parsed.rows.length === 0) {
        return {
            ok: false,
            delimiter: parsed.error ? delimiter : null,
            rows: [],
            sourceRowCount: 0,
            issues: [issue(null, null, "invalid_csv")],
        };
    }

    const rawHeaders = parsed.rows[0];
    const headers = rawHeaders.map((header) => {
        const normalized = normalizedHeader(header);
        return HEADER_ALIASES[normalized] ?? normalized;
    });
    const issues: BeautyMovementImportIssue[] = [];
    const headerIndex = new Map<string, number>();
    for (const [index, header] of headers.entries()) {
        if (!header) {
            issues.push(issue(1, null, "unknown_header"));
            continue;
        }
        if (FORBIDDEN_HEADERS.has(header)) {
            issues.push(issue(1, header, "forbidden_header"));
            continue;
        }
        if (!ALLOWED_HEADERS.has(header)) {
            issues.push(issue(1, header, "unknown_header"));
            continue;
        }
        if (headerIndex.has(header)) {
            issues.push(issue(1, header, "duplicate_header"));
            continue;
        }
        headerIndex.set(header, index);
    }

    const isCompactVelocity = COMPACT_VELOCITY_REQUIRED_HEADERS.every((header) => headerIndex.has(header)) &&
        !headerIndex.has("invite_ref") &&
        !headerIndex.has("palette") &&
        !headerIndex.has("velocity_benefit") &&
        !headerIndex.has("expires_at") &&
        !headerIndex.has("invite_status") &&
        !headerIndex.has("reward_id");
    const requiredHeaders = isCompactVelocity ? COMPACT_VELOCITY_REQUIRED_HEADERS : REQUIRED_HEADERS;
    for (const header of requiredHeaders) {
        if (!headerIndex.has(header)) issues.push(issue(1, header, "missing_header"));
    }
    if (issues.length) {
        return { ok: false, delimiter, rows: [], sourceRowCount: 0, issues };
    }

    const rewardHeader = headerIndex.get("reward_id");
    const hasRewardValues = rewardHeader !== undefined && parsed.rows.slice(1).some((row) => (row[rewardHeader] ?? "").trim().length > 0);
    if (hasRewardValues && (!params.rewardCatalog || params.rewardCatalog.length === 0)) {
        return {
            ok: false,
            delimiter,
            rows: [],
            sourceRowCount: 0,
            issues: [issue(null, "reward_id", "missing_reward_catalog")],
        };
    }
    const rewardById = new Map((params.rewardCatalog ?? []).map((reward) => [reward.rewardId, reward]));

    const nowMs = params.nowMs ?? Date.now();
    const importRows: BeautyMovementImportRow[] = [];
    const inviteRefs = new Set<string>();
    const phones = new Set<string>();
    let sourceRowCount = 0;

    for (let index = 1; index < parsed.rows.length; index += 1) {
        const sourceRow = parsed.rows[index];
        const rowNumber = index + 1;
        if (!rowHasAnyValue(sourceRow)) continue;
        sourceRowCount += 1;
        if (sourceRow.length !== headers.length) {
            issues.push(issue(rowNumber, null, "column_count_mismatch"));
            continue;
        }
        const value = (header: string) => {
            const columnIndex = headerIndex.get(header);
            return columnIndex === undefined ? "" : sourceRow[columnIndex] ?? "";
        };

        const inviteRef = isCompactVelocity
            ? `velocity-${String(rowNumber).padStart(4, "0")}`
            : cleanText(value("invite_ref"), 120);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(inviteRef)) {
            issues.push(issue(rowNumber, "invite_ref", inviteRef ? "invalid_invite_ref" : "required_value_missing"));
        } else if (containsProhibitedSensitiveValue(inviteRef)) {
            // external_ref is retained in clear text for reconciliation, so it
            // must never be allowed to carry a CPF or clinical-history marker.
            issues.push(issue(rowNumber, "invite_ref", "prohibited_sensitive_value"));
        } else if (inviteRefs.has(inviteRef)) {
            issues.push(issue(rowNumber, "invite_ref", "duplicate_invite_ref"));
        } else {
            inviteRefs.add(inviteRef);
        }

        const name = cleanText(value("name"), 160);
        // A single-word civil name is valid input for an invitation list. Keep
        // the minimum meaningful length/sensitive-value checks, but do not
        // invent a surname or reject a real invite solely because the sheet
        // contains one name token.
        const nameTokens = name.split(/\s+/).filter((part) => part.length >= 2);
        if (name.length < 2 || nameTokens.length === 0) {
            issues.push(issue(rowNumber, "name", name ? "invalid_name" : "required_value_missing"));
        }
        if (name && containsProhibitedSensitiveValue(name)) {
            issues.push(issue(rowNumber, "name", "prohibited_sensitive_value"));
        }

        const whatsapp = normalizePhone(value("whatsapp"));
        if (!whatsapp) {
            issues.push(issue(rowNumber, "whatsapp", value("whatsapp").trim() ? "invalid_whatsapp" : "required_value_missing"));
        } else if (phones.has(whatsapp)) {
            issues.push(issue(rowNumber, "whatsapp", "duplicate_whatsapp"));
        } else {
            phones.add(whatsapp);
        }

        const rawEmail = value("email");
        const email = normalizeEmail(rawEmail);
        if (rawEmail.trim() && !email) {
            issues.push(issue(rowNumber, "email", "invalid_email"));
        }

        const palette = isCompactVelocity
            ? BEAUTY_MOVEMENT_COMPACT_VELOCITY_PALETTE
            : asAllowed(cleanText(value("palette"), 40).toLowerCase(), BEAUTY_MOVEMENT_PALETTES);
        if (!palette) issues.push(issue(rowNumber, "palette", value("palette").trim() ? "invalid_palette" : "required_value_missing"));

        const rawRewardId = value("reward_id").trim();
        const rewardId = rawRewardId ? cleanText(rawRewardId, 120) : null;
        const reward = rewardId ? rewardById.get(rewardId) : null;
        if (rewardId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(rewardId)) {
            issues.push(issue(rowNumber, "reward_id", "invalid_reward_id"));
        } else if (rewardId && !reward) {
            issues.push(issue(rowNumber, "reward_id", "reward_not_found"));
        } else if (rewardId && palette && reward && reward.family !== palette) {
            issues.push(issue(rowNumber, "reward_id", "reward_family_mismatch"));
        }

        const rawPrize = cleanText(value("prize"), 80);
        const assignedOutcomeKey = rawPrize ? normalizePrize(rawPrize) : null;
        if (rawPrize && assignedOutcomeKey === undefined) {
            issues.push(issue(rowNumber, "prize", "unsupported_prize"));
        }
        let velocityBenefit: BeautyMovementVelocityBenefit | null;
        if (isCompactVelocity) {
            // The compact sheet is now the canonical invite source: Velocity
            // rows receive the courtesy entitlement, while each commercial
            // prize is an explicit server-side assignment.
            velocityBenefit = assignedOutcomeKey === null ? "aula_cortesia_evento" : "none";
        } else {
            velocityBenefit = asAllowed(
                cleanText(value("velocity_benefit"), 40).toLowerCase(),
                ["none", "aula_cortesia_evento"] as const,
            );
            if (assignedOutcomeKey !== null && assignedOutcomeKey !== undefined) {
                // The sheet is authoritative for a prepared invite. A stale
                // legacy courtesy flag must never turn a commercial prize into
                // a mixed entitlement.
                velocityBenefit = "none";
            } else if (assignedOutcomeKey === null && rawPrize) {
                velocityBenefit = "aula_cortesia_evento";
            }
            if (!velocityBenefit) {
                issues.push(issue(
                    rowNumber,
                    "velocity_benefit",
                    value("velocity_benefit").trim() ? "invalid_velocity_benefit" : "required_value_missing",
                ));
            }
        }

        const inviteStatus = isCompactVelocity
            ? "active" as const
            : asAllowed(
                cleanText(value("invite_status"), 32).toLowerCase() || "active",
                BEAUTY_MOVEMENT_INVITE_STATUSES,
            );
        if (!inviteStatus) issues.push(issue(rowNumber, "invite_status", "invalid_invite_status"));

        const expiresAtMs = isCompactVelocity
            ? Number.isFinite(params.defaultExpiresAtMs) ? params.defaultExpiresAtMs! : null
            : parseStrictIsoDate(value("expires_at"));
        if (expiresAtMs === null) {
            issues.push(issue(
                rowNumber,
                "expires_at",
                isCompactVelocity
                    ? "compact_expiry_unavailable"
                    : value("expires_at").trim() ? "invalid_expiry" : "required_value_missing",
            ));
        } else if (inviteStatus === "active" && expiresAtMs <= nowMs) {
            issues.push(issue(rowNumber, "expires_at", "expired_invite"));
        }

        if (
            inviteRef &&
            name &&
            whatsapp &&
            (rawEmail.trim() === "" || email) &&
            palette &&
            (!rewardId || reward) &&
            assignedOutcomeKey !== undefined &&
            velocityBenefit &&
            inviteStatus &&
            expiresAtMs !== null
        ) {
            importRows.push({
                inviteRef,
                sourceFormat: isCompactVelocity ? "compact_velocity" : "full",
                name,
                whatsapp,
                email,
                palette,
                rewardId,
                assignedOutcomeKey,
                prizeAssigned: isCompactVelocity || Boolean(rawPrize),
                velocityBenefit,
                expiresAtMs,
                inviteStatus,
            });
        }
    }

    if (issues.length) return { ok: false, delimiter, rows: [], sourceRowCount, issues };
    return { ok: true, delimiter, rows: importRows, sourceRowCount };
}

function escapeSql(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function sha256Hex(value: string): Promise<string> {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((buffer) =>
        Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function validateCampaignId(value: string): string {
    const campaignId = value.trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(campaignId)) {
        throw new Error("beauty_movement_invalid_campaign_id");
    }
    return campaignId;
}

function buildInviteUrl(baseUrl: string, token: string): string {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.search || url.hash) {
        throw new Error("beauty_movement_invalid_invite_base_url");
    }
    url.hash = `c=${token}`;
    return url.toString();
}

export async function prepareBeautyMovementImport(params: {
    csv: string;
    campaignId: string;
    campaignConfig: BeautyMovementCampaignConfig;
    campaignEndsAtMs: number;
    rewardCatalog?: readonly BeautyMovementRewardCatalogEntry[];
    procedureCatalog?: readonly BeautyMovementCanonicalProcedure[];
    tokenHmacKey: string;
    piiKey: string;
    inviteUrlBase?: string;
    nowMs?: number;
}): Promise<BeautyMovementPreparedImport> {
    const nowMs = params.nowMs ?? Date.now();
    const campaignId = validateCampaignId(params.campaignId);
    if (!Number.isFinite(params.campaignEndsAtMs) || params.campaignEndsAtMs <= nowMs) {
        throw new Error("beauty_movement_invalid_campaign_expiry");
    }
    if (params.campaignConfig.startsAtMs !== null && params.campaignConfig.startsAtMs > params.campaignEndsAtMs) {
        throw new Error("beauty_movement_campaign_start_after_end");
    }
    const rewards = params.rewardCatalog && params.rewardCatalog.length > 0
        ? validateBeautyMovementRewardCatalog({ catalog: params.rewardCatalog, procedureCatalog: params.procedureCatalog ?? [] })
        : [];
    const rewardById = new Map(rewards.map((reward) => [reward.rewardId, reward]));
    const validation = validateBeautyMovementImport({
        csv: params.csv,
        rewardCatalog: rewards,
        nowMs,
        defaultExpiresAtMs: params.campaignEndsAtMs,
    });
    if (!validation.ok) {
        throw new Error(`beauty_movement_import_invalid:${validation.issues.map((entry) => entry.code).join(",")}`);
    }
    if (validation.rows.some((row) => row.expiresAtMs > params.campaignEndsAtMs)) {
        throw new Error("beauty_movement_campaign_expiry_before_invite");
    }

    const inputSha256 = await sha256Hex(params.csv);
    const inviteUrlBase = params.inviteUrlBase ?? "https://espacofacial.com/beleza-em-movimento";
    const invites: BeautyMovementPreparedInvite[] = [];
    const deliveryRows: BeautyMovementDeliveryRow[] = [];

    for (const row of validation.rows) {
        const inviteRef = row.sourceFormat === "compact_velocity"
            ? `velocity-${await hashBeautyMovementInviteToken({
                secret: params.tokenHmacKey,
                token: `velocity-${campaignId}-${row.whatsapp.replace(/\D/g, "")}`,
            })}`
            : row.inviteRef;
        const reward = row.rewardId ? rewardById.get(row.rewardId) ?? null : null;
        if (row.rewardId && !reward) throw new Error("beauty_movement_reward_not_found");
        const token = await deriveBeautyMovementInviteToken({
            secret: params.tokenHmacKey,
            campaignId,
            inviteRef,
        });
        const inviteTokenHmac = await hashBeautyMovementInviteToken({ secret: params.tokenHmacKey, token });
        const encrypted = await encryptBeautyMovementPersonalData({
            name: row.name,
            whatsapp: row.whatsapp,
            email: row.email,
        }, params.piiKey);
        const plannedCardSelections = selectBeautyMovementPlannedSelections({
            palette: row.palette,
            outcomeKey: row.prizeAssigned ? row.assignedOutcomeKey : null,
        });
        invites.push({
            id: crypto.randomUUID(),
            inviteRef,
            inviteTokenHmac,
            personalDataCiphertext: encrypted.ciphertext,
            personalDataIv: encrypted.iv,
            contactMask: maskBeautyMovementContact(row.whatsapp, row.email),
            palette: row.palette,
            rewardId: reward?.rewardId ?? null,
            assignedOutcomeKey: row.assignedOutcomeKey,
            assignmentProtocolVersion: row.prizeAssigned ? BEAUTY_MOVEMENT_ASSIGNMENT_PROTOCOL_VERSION : null,
            plannedCardSelectionsJson: JSON.stringify(plannedCardSelections),
            velocityBenefit: row.velocityBenefit,
            // Legacy columns remain populated during the additive migration so
            // old reports/readers fail closed instead of losing the approved
            // condition while the structured reward join is rolled out.
            benefitStatus: reward ? "evento_condicao_comercial" : row.velocityBenefit === "aula_cortesia_evento" ? "aula_cortesia_evento" : "evento_condicao_comercial",
            benefitText: reward?.displayText ?? (row.prizeAssigned
                ? row.assignedOutcomeKey
                    ? getBeautyMovementOffer(row.assignedOutcomeKey).commercialText
                    : "Sua combinação desbloqueou a aula-cortesia Velocity."
                : "Sua combinação será determinada pelas três cartas."),
            benefitValidity: reward?.validity ?? "Definida após a confirmação da leitura.",
            benefitRules: reward?.rules ?? "A elegibilidade clínica depende de avaliação profissional.",
            termsVersion: reward?.termsVersion ?? "beauty-movement-outcomes-v1",
            expiresAtMs: row.expiresAtMs,
            inviteStatus: row.inviteStatus,
        });
        deliveryRows.push({
            name: row.name,
            inviteRef,
            whatsapp: row.whatsapp,
            inviteUrl: buildInviteUrl(inviteUrlBase, token),
        });
    }

    return {
        campaignId,
        campaignConfig: params.campaignConfig,
        campaignEndsAtMs: params.campaignEndsAtMs,
        inputSha256,
        sourceRowCount: validation.sourceRowCount,
        createdAtMs: nowMs,
        importRunId: crypto.randomUUID(),
        rewards,
        invites,
        deliveryRows,
    };
}

export function buildBeautyMovementImportSql(plan: BeautyMovementPreparedImport): string {
    const campaign = plan.campaignConfig;
    // Wrangler sends a SQL file to D1 as a batch. D1 batches are atomic, while
    // the local workerd runtime deliberately rejects explicit BEGIN/COMMIT.
    // Keeping the statements transaction-free preserves the all-or-nothing
    // contract in both local validation and the remote API.
    const statements = [
        `INSERT INTO bm_campaigns (
            id, status, starts_at_ms, ends_at_ms,
            title, description, invitation_title, invitation_text, partner_name,
            whatsapp_message_courtesy, whatsapp_message_commercial, whatsapp_label, conditions_label, conditions_text,
            velocity_benefit_label, velocity_benefit_text,
            created_at_ms, updated_at_ms
        ) VALUES (
            ${escapeSql(plan.campaignId)}, 'draft', ${campaign.startsAtMs ?? "NULL"}, ${plan.campaignEndsAtMs},
            ${escapeSql(campaign.title)}, ${escapeSql(campaign.description)}, ${escapeSql(campaign.invitationTitle)}, ${escapeSql(campaign.invitationText)}, ${escapeSql(campaign.partnerName)},
            ${escapeSql(campaign.whatsappMessageCourtesy)}, ${escapeSql(campaign.whatsappMessageCommercial)}, ${escapeSql(campaign.whatsappLabel)}, ${escapeSql(campaign.conditionsLabel)}, ${escapeSql(campaign.conditionsText)},
            ${escapeSql(campaign.velocityBenefitLabel)}, ${escapeSql(campaign.velocityBenefitText)},
            ${plan.createdAtMs}, ${plan.createdAtMs}
        ) ON CONFLICT(id) DO UPDATE SET
            starts_at_ms = excluded.starts_at_ms,
            ends_at_ms = excluded.ends_at_ms,
            title = excluded.title,
            description = excluded.description,
            invitation_title = excluded.invitation_title,
            invitation_text = excluded.invitation_text,
            partner_name = excluded.partner_name,
            whatsapp_message_courtesy = excluded.whatsapp_message_courtesy,
            whatsapp_message_commercial = excluded.whatsapp_message_commercial,
            whatsapp_label = excluded.whatsapp_label,
            conditions_label = excluded.conditions_label,
            conditions_text = excluded.conditions_text,
            velocity_benefit_label = excluded.velocity_benefit_label,
            velocity_benefit_text = excluded.velocity_benefit_text,
            updated_at_ms = excluded.updated_at_ms
        WHERE bm_campaigns.status = 'draft';`,
    ];

    for (const reward of plan.rewards) {
        const discountKind = reward.discount ? escapeSql(reward.discount.kind) : "NULL";
        const discountValue = reward.discount ? String(reward.discount.value) : "NULL";
        const discountCurrency = reward.discount ? escapeSql(reward.discount.currency) : "NULL";
        statements.push(
            `INSERT INTO bm_rewards (
                campaign_id, reward_id, family, reward_type,
                procedure_id, procedure_name, discount_kind, discount_value, discount_currency,
                display_text, validity, rules, terms_version, approved_at_ms, created_at_ms, updated_at_ms
            ) VALUES (
                ${escapeSql(plan.campaignId)}, ${escapeSql(reward.rewardId)}, ${escapeSql(reward.family)}, ${escapeSql(reward.type)},
                ${escapeSql(reward.procedureId)}, ${escapeSql(reward.procedureName)}, ${discountKind}, ${discountValue}, ${discountCurrency},
                ${escapeSql(reward.displayText)}, ${escapeSql(reward.validity)}, ${escapeSql(reward.rules)}, ${escapeSql(reward.termsVersion)}, ${reward.approvedAtMs}, ${plan.createdAtMs}, ${plan.createdAtMs}
            ) ON CONFLICT(campaign_id, reward_id) DO UPDATE SET
                family = excluded.family,
                reward_type = excluded.reward_type,
                procedure_id = excluded.procedure_id,
                procedure_name = excluded.procedure_name,
                discount_kind = excluded.discount_kind,
                discount_value = excluded.discount_value,
                discount_currency = excluded.discount_currency,
                display_text = excluded.display_text,
                validity = excluded.validity,
                rules = excluded.rules,
                terms_version = excluded.terms_version,
                approved_at_ms = excluded.approved_at_ms,
                updated_at_ms = excluded.updated_at_ms
            WHERE (SELECT status FROM bm_campaigns WHERE id = excluded.campaign_id) = 'draft';`,
        );
    }

    for (const invite of plan.invites) {
        statements.push(
            `INSERT INTO bm_invites (
                id, campaign_id, external_ref, invite_token_hmac,
                personal_data_version, personal_data_ciphertext, personal_data_iv, contact_mask,
                palette, reward_id, velocity_benefit,
                assigned_outcome_key, assignment_protocol_version, planned_card_selections_json,
                benefit_status, benefit_text, benefit_validity, benefit_rules, terms_version,
                invite_status, expires_at_ms, created_at_ms, updated_at_ms
            ) VALUES (
                ${escapeSql(invite.id)}, ${escapeSql(plan.campaignId)}, ${escapeSql(invite.inviteRef)}, ${escapeSql(invite.inviteTokenHmac)},
                1, ${escapeSql(invite.personalDataCiphertext)}, ${escapeSql(invite.personalDataIv)}, ${escapeSql(invite.contactMask)},
                ${escapeSql(invite.palette)}, ${invite.rewardId ? escapeSql(invite.rewardId) : "NULL"}, ${escapeSql(invite.velocityBenefit)},
                ${invite.assignedOutcomeKey ? escapeSql(invite.assignedOutcomeKey) : "NULL"}, ${invite.assignmentProtocolVersion ? escapeSql(invite.assignmentProtocolVersion) : "NULL"}, ${escapeSql(invite.plannedCardSelectionsJson)},
                ${escapeSql(invite.benefitStatus)}, ${escapeSql(invite.benefitText)}, ${escapeSql(invite.benefitValidity)}, ${escapeSql(invite.benefitRules)}, ${escapeSql(invite.termsVersion)},
                ${escapeSql(invite.inviteStatus)}, ${invite.expiresAtMs}, ${plan.createdAtMs}, ${plan.createdAtMs}
            ) ON CONFLICT(campaign_id, external_ref) DO UPDATE SET
                personal_data_version = excluded.personal_data_version,
                personal_data_ciphertext = excluded.personal_data_ciphertext,
                personal_data_iv = excluded.personal_data_iv,
                contact_mask = excluded.contact_mask,
                palette = excluded.palette,
                reward_id = excluded.reward_id,
                velocity_benefit = excluded.velocity_benefit,
                assigned_outcome_key = excluded.assigned_outcome_key,
                assignment_protocol_version = excluded.assignment_protocol_version,
                planned_card_selections_json = excluded.planned_card_selections_json,
                benefit_status = excluded.benefit_status,
                benefit_text = excluded.benefit_text,
                benefit_validity = excluded.benefit_validity,
                benefit_rules = excluded.benefit_rules,
                terms_version = excluded.terms_version,
                -- Revocation is intentionally sticky. Re-importing a delivery
                -- list must never revive a deterministic invitation link.
                invite_status = CASE
                    WHEN bm_invites.invite_status = 'revoked' OR excluded.invite_status = 'revoked' THEN 'revoked'
                    ELSE 'active'
                END,
                expires_at_ms = excluded.expires_at_ms,
                updated_at_ms = excluded.updated_at_ms
             WHERE bm_invites.confirmed_at_ms IS NULL
               AND (SELECT status FROM bm_campaigns WHERE id = excluded.campaign_id) = 'draft';`,
        );
    }

    statements.push(
        `INSERT INTO bm_import_runs (
            id, campaign_id, input_sha256, source_row_count, accepted_row_count, status, created_at_ms, applied_at_ms
        ) VALUES (
            ${escapeSql(plan.importRunId)}, ${escapeSql(plan.campaignId)}, ${escapeSql(plan.inputSha256)}, ${plan.sourceRowCount}, ${plan.invites.length}, 'applied', ${plan.createdAtMs}, ${plan.createdAtMs}
        ) ON CONFLICT(campaign_id, input_sha256) DO UPDATE SET
            source_row_count = excluded.source_row_count,
            accepted_row_count = excluded.accepted_row_count,
            status = excluded.status,
            applied_at_ms = excluded.applied_at_ms;`,
    );
    return `${statements.join("\n\n")}\n`;
}

function csvCell(value: string): string {
    const formulaSafe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function serializeBeautyMovementDeliveryCsv(rows: readonly BeautyMovementDeliveryRow[]): string {
    const output = ["name,invite_ref,whatsapp,invite_url"];
    for (const row of rows) {
        output.push([row.name, row.inviteRef, row.whatsapp, row.inviteUrl].map(csvCell).join(","));
    }
    return `${output.join("\n")}\n`;
}

export function summarizeBeautyMovementImport(validation: BeautyMovementImportValidation): Record<string, number | boolean> {
    if (!validation.ok) {
        return {
            ok: false,
            sourceRows: validation.sourceRowCount,
            issues: validation.issues.length,
        };
    }
    return {
        ok: true,
        sourceRows: validation.sourceRowCount,
        acceptedRows: validation.rows.length,
    };
}
