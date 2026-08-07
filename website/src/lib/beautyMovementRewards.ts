import type { BeautyMovementPalette } from "@/lib/beautyMovementImport";

const BEAUTY_MOVEMENT_REWARD_FAMILIES = ["radiancia", "ritmo", "conexao"] as const;

export const BEAUTY_MOVEMENT_REWARD_TYPES = ["free_procedure", "discount"] as const;
export const BEAUTY_MOVEMENT_DISCOUNT_KINDS = ["percent", "fixed"] as const;
export const BEAUTY_MOVEMENT_VELOCITY_BENEFITS = ["none", "aula_cortesia_evento"] as const;

export type BeautyMovementRewardType = (typeof BEAUTY_MOVEMENT_REWARD_TYPES)[number];
export type BeautyMovementDiscountKind = (typeof BEAUTY_MOVEMENT_DISCOUNT_KINDS)[number];
export type BeautyMovementVelocityBenefit = (typeof BEAUTY_MOVEMENT_VELOCITY_BENEFITS)[number];

export type BeautyMovementDiscount = {
    kind: BeautyMovementDiscountKind;
    value: number;
    currency: "BRL";
};

export type BeautyMovementCanonicalProcedure = {
    procedureId: string;
    procedureName: string;
};

export type BeautyMovementRewardCatalogEntry = {
    rewardId: string;
    family: BeautyMovementPalette;
    type: BeautyMovementRewardType;
    procedureId: string;
    procedureName: string;
    discount: BeautyMovementDiscount | null;
    displayText: string;
    validity: string;
    rules: string;
    termsVersion: string;
    approvedAt: string;
};

export type BeautyMovementValidatedReward = BeautyMovementRewardCatalogEntry & {
    approvedAtMs: number;
};

const REWARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const SENSITIVE_REWARD_VALUE_TERMS = /\b(?:cpf|diagnostico|laudo|prontuario|historico\s+(?:medico|clinico|de\s+procedimentos?)|doenca|comorbidade|medicacao)\b/i;

function cleanText(value: unknown, maxLength: number): string {
    if (typeof value !== "string") return "";
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return "";
    return normalized;
}

function parseApprovedAt(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeProcedureCatalog(value: readonly BeautyMovementCanonicalProcedure[]): Map<string, string> {
    const catalog = new Map<string, string>();
    for (const entry of value) {
        const procedureId = cleanText(entry?.procedureId, 120);
        const procedureName = cleanText(entry?.procedureName, 160);
        if (!REWARD_ID_PATTERN.test(procedureId) || !procedureName || catalog.has(procedureId)) {
            throw new Error("beauty_movement_procedure_catalog_invalid");
        }
        catalog.set(procedureId, procedureName);
    }
    if (catalog.size === 0) throw new Error("beauty_movement_procedure_catalog_invalid");
    return catalog;
}

function normalizeDiscount(value: unknown, type: BeautyMovementRewardType): BeautyMovementDiscount | null {
    if (type === "free_procedure") {
        if (value !== null && value !== undefined) throw new Error("beauty_movement_reward_discount_not_allowed");
        return null;
    }
    if (!isRecord(value)) throw new Error("beauty_movement_reward_discount_invalid");
    const kind = value.kind;
    const amount = value.value;
    const currency = value.currency;
    if (!BEAUTY_MOVEMENT_DISCOUNT_KINDS.includes(kind as BeautyMovementDiscountKind)) {
        throw new Error("beauty_movement_reward_discount_invalid");
    }
    if (currency !== "BRL" || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("beauty_movement_reward_discount_invalid");
    }
    if (kind === "percent" && amount > 100) throw new Error("beauty_movement_reward_discount_invalid");
    return { kind: kind as BeautyMovementDiscountKind, value: amount, currency: "BRL" };
}

/**
 * Validates the private reward catalog against a snapshot of the canonical CRM
 * procedure catalog. The public application never queries CRM directly.
 */
export function validateBeautyMovementRewardCatalog(params: {
    catalog: unknown;
    procedureCatalog: readonly BeautyMovementCanonicalProcedure[];
}): BeautyMovementValidatedReward[] {
    if (!Array.isArray(params.catalog)) throw new Error("beauty_movement_reward_catalog_invalid");
    const procedures = normalizeProcedureCatalog(params.procedureCatalog);
    const seen = new Set<string>();
    const rewards: BeautyMovementValidatedReward[] = [];

    for (const item of params.catalog) {
        if (!isRecord(item)) throw new Error("beauty_movement_reward_catalog_invalid");
        const rewardId = cleanText(item.rewardId, 120);
        const family = cleanText(item.family, 40).toLowerCase() as BeautyMovementPalette;
        const type = cleanText(item.type, 40).toLowerCase() as BeautyMovementRewardType;
        const procedureId = cleanText(item.procedureId, 120);
        const procedureName = cleanText(item.procedureName, 160);
        const displayText = cleanText(item.displayText, 500);
        const validity = cleanText(item.validity, 300);
        const rules = cleanText(item.rules, 1200);
        const termsVersion = cleanText(item.termsVersion, 120);
        const approvedAt = cleanText(item.approvedAt, 40);

        if (!REWARD_ID_PATTERN.test(rewardId) || seen.has(rewardId)) throw new Error("beauty_movement_reward_id_invalid");
        if (!BEAUTY_MOVEMENT_REWARD_FAMILIES.includes(family)) throw new Error("beauty_movement_reward_family_invalid");
        if (!BEAUTY_MOVEMENT_REWARD_TYPES.includes(type)) throw new Error("beauty_movement_reward_type_invalid");
        if (!procedureId || !procedureName || procedures.get(procedureId) !== procedureName) {
            throw new Error("beauty_movement_reward_procedure_invalid");
        }
        if (!displayText || !validity || !rules || !termsVersion || SENSITIVE_REWARD_VALUE_TERMS.test(`${displayText} ${validity} ${rules}`)) {
            throw new Error("beauty_movement_reward_copy_invalid");
        }
        const approvedAtMs = parseApprovedAt(approvedAt);
        if (approvedAtMs === null) throw new Error("beauty_movement_reward_approval_invalid");

        const discount = normalizeDiscount(item.discount, type);
        seen.add(rewardId);
        rewards.push({
            rewardId,
            family,
            type,
            procedureId,
            procedureName,
            discount,
            displayText,
            validity,
            rules,
            termsVersion,
            approvedAt,
            approvedAtMs,
        });
    }

    if (rewards.length === 0) throw new Error("beauty_movement_reward_catalog_empty");
    return rewards;
}
