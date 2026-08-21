import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
    buildBeautyMovementImportSql,
    prepareBeautyMovementImport,
    serializeBeautyMovementDeliveryCsv,
    validateBeautyMovementCampaignConfig,
    validateBeautyMovementImport,
} from "../src/lib/beautyMovementImport";
import { validateBeautyMovementRewardCatalog } from "../src/lib/beautyMovementRewards";

const TOKEN_KEY = `test-token-hmac-${"0".repeat(16)}`;
const PII_KEY = "0".repeat(64);
const NOW = Date.parse("2026-08-01T12:00:00Z");
const EXPIRES = "2026-08-31T23:59:00Z";
const EXPIRES_MS = Date.parse(EXPIRES);

const PROCEDURES = [
    { procedureId: "lavieen", procedureName: "Lavieen" },
    { procedureId: "botox", procedureName: "Botox" },
];

const REWARDS = [
    {
        rewardId: "rad-lavieen-free",
        family: "radiancia" as const,
        type: "free_procedure" as const,
        procedureId: "lavieen",
        procedureName: "Lavieen",
        discount: null,
        displayText: "Um cuidado de renovação para celebrar seu momento.",
        validity: "Válida até 31/08/2026.",
        rules: "Uso pessoal e intransferível; agendamento sujeito à disponibilidade.",
        termsVersion: "v1",
        approvedAt: "2026-07-30T12:00:00Z",
    },
];

function validCsv(overrides = ""): string {
    return [
        "invite_ref,name,whatsapp,email,palette,reward_id,velocity_benefit,expires_at",
        `nh-001,Ana Silva,51999991234,ana@example.com,radiancia,rad-lavieen-free,aula_cortesia_evento,${EXPIRES}${overrides}`,
    ].join("\n");
}

function validCampaignConfig() {
    return validateBeautyMovementCampaignConfig({
        title: "Beleza que se move com você.",
        description: "Cartas da Beleza em Movimento celebra os 3 anos da Espaço Facial Novo Hamburgo.",
        invitationTitle: "Seu convite para celebrar",
        invitationText: "A equipe vai confirmar os próximos detalhes com você.",
        partnerName: "Velocity",
        whatsappMessageCourtesy: "Olá! Quero confirmar minha aula-cortesia.",
        whatsappMessageCommercial: "Olá! Quero falar sobre a condição do meu convite.",
        whatsappLabel: "Falar com a equipe",
        conditionsLabel: "Ler condições da campanha",
        conditionsText: "Condições da campanha previamente aprovadas.",
        velocityBenefitLabel: "Aula-cortesia Velocity",
        velocityBenefitText: "A equipe confirmará a turma e os detalhes operacionais.",
        startsAt: "2026-08-10T12:00:00Z",
    });
}

test("beauty movement import validates only the sanitised private-list schema", () => {
    const valid = validateBeautyMovementImport({ csv: validCsv(), rewardCatalog: REWARDS, nowMs: NOW });
    assert.equal(valid.ok, true);
    if (valid.ok) {
        assert.equal(valid.rows[0]?.rewardId, "rad-lavieen-free");
        assert.equal(valid.rows[0]?.velocityBenefit, "aula_cortesia_evento");
        assert.equal(valid.rows[0]?.whatsapp, "+5551999991234");
    }

    const forbidden = validateBeautyMovementImport({
        csv: validCsv().replace("expires_at", "expires_at,cpf").replace(EXPIRES, `${EXPIRES},12345678901`),
        rewardCatalog: REWARDS,
        nowMs: NOW,
    });
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.issues.some((entry) => entry.code === "forbidden_header"), true);

    const sensitiveValue = validateBeautyMovementImport({
        csv: validCsv().replace("Ana Silva", "CPF 529.982.247-25"),
        rewardCatalog: REWARDS,
        nowMs: NOW,
    });
    assert.equal(sensitiveValue.ok, false);
    if (!sensitiveValue.ok) {
        assert.equal(sensitiveValue.issues.some((entry) => entry.code === "prohibited_sensitive_value"), true);
    }

    const cpfInReference = validateBeautyMovementImport({
        csv: validCsv().replace("nh-001", "52998224725"),
        rewardCatalog: REWARDS,
        nowMs: NOW,
    });
    assert.equal(cpfInReference.ok, false);
    if (!cpfInReference.ok) {
        assert.equal(cpfInReference.issues.some((entry) => entry.column === "invite_ref" && entry.code === "prohibited_sensitive_value"), true);
    }

    const procedureHistory = validateBeautyMovementImport({
        csv: validCsv().replace("Ana Silva", "Histórico de procedimentos informado"),
        rewardCatalog: REWARDS,
        nowMs: NOW,
    });
    assert.equal(procedureHistory.ok, false);
    if (!procedureHistory.ok) {
        assert.equal(procedureHistory.issues.some((entry) => entry.code === "prohibited_sensitive_value"), true);
    }

    const duplicate = validateBeautyMovementImport({
        csv: `${validCsv()}\nnh-002,Bea Souza,51999991234,,radiancia,rad-lavieen-free,none,${EXPIRES}`,
        rewardCatalog: REWARDS,
        nowMs: NOW,
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.issues.some((entry) => entry.code === "duplicate_whatsapp"), true);
});

test("compact Velocity sheet rows accept the sheet columns and optional duplicate email", async () => {
    const csv = [
        "NOME,TELEFONE,EMAIL,PRÊMIO",
        "Ana Silva,51999991234,shared@example.com,Velocity",
        "Bea Souza,51999991235,shared@example.com,Velocity",
    ].join("\n");
    const validation = validateBeautyMovementImport({
        csv,
        nowMs: NOW,
        defaultExpiresAtMs: EXPIRES_MS,
    });
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.deepEqual(validation.rows.map((row) => row.inviteRef), ["velocity-0002", "velocity-0003"]);
    assert.equal(validation.rows.every((row) => row.palette === "radiancia"), true);
    assert.equal(validation.rows.every((row) => row.velocityBenefit === "aula_cortesia_evento"), true);
    assert.equal(validation.rows.every((row) => row.expiresAtMs === EXPIRES_MS), true);
    assert.equal(validation.rows.every((row) => row.inviteStatus === "active"), true);
    assert.equal(validation.rows.every((row) => row.rewardId === null), true);

    const plan = await prepareBeautyMovementImport({
        csv,
        campaignId: "nh-velocity",
        campaignConfig: validCampaignConfig(),
        campaignEndsAtMs: EXPIRES_MS,
        tokenHmacKey: TOKEN_KEY,
        piiKey: PII_KEY,
        nowMs: NOW,
    });
    assert.equal(plan.invites.length, 2);
    assert.equal(plan.deliveryRows.length, 2);
    assert.equal(plan.invites.every((invite) => invite.velocityBenefit === "aula_cortesia_evento"), true);
    assert.equal(plan.invites.every((invite) => invite.rewardId === null), true);
    assert.equal(plan.deliveryRows.every((row) => row.inviteUrl.startsWith("https://espacofacial.com/beleza-em-movimento#c=")), true);
});

test("compact Velocity imports also accept only name and WhatsApp", () => {
    const validation = validateBeautyMovementImport({
        csv: [
            "NOME,TELEFONE",
            "Ana Silva,51999991234",
        ].join("\n"),
        nowMs: NOW,
        defaultExpiresAtMs: EXPIRES_MS,
    });
    assert.equal(validation.ok, true);
    if (validation.ok) assert.equal(validation.rows[0]?.velocityBenefit, "aula_cortesia_evento");
});

test("compact Velocity imports fail closed without campaign expiry or with another prize", () => {
    const csv = [
        "nome,telefone,premio",
        "Ana Silva,51999991234,Velocity",
    ].join("\n");
    const withoutExpiry = validateBeautyMovementImport({ csv, nowMs: NOW });
    assert.equal(withoutExpiry.ok, false);
    if (!withoutExpiry.ok) assert.equal(withoutExpiry.issues.some((entry) => entry.code === "compact_expiry_unavailable"), true);

    const unsupported = validateBeautyMovementImport({
        csv: csv.replace("Velocity", "Preenchimento"),
        nowMs: NOW,
        defaultExpiresAtMs: EXPIRES_MS,
    });
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) assert.equal(unsupported.issues.some((entry) => entry.code === "unsupported_prize"), true);
});

test("CLI dry-run forwards campaign expiry to compact Velocity validation", async () => {
    await mkdtemp(path.join(tmpdir(), "beauty-movement-cli-test-")).then(async (directory) => {
        const inputPath = path.join(directory, "invites.csv");
        const campaignPath = path.join(directory, "campaign.json");
        const endsAt = "2099-12-31T23:59:00Z";
        const campaign = {
            title: "Teste sintético",
            description: "Fixture sintética do importador.",
            invitationTitle: "Convite sintético",
            invitationText: "Texto sintético.",
            partnerName: "Synthetic QA",
            whatsappMessageCourtesy: "Mensagem sintética.",
            whatsappMessageCommercial: "Mensagem comercial sintética.",
            whatsappLabel: "Falar com a equipe",
            conditionsLabel: "Condições",
            conditionsText: "Condições sintéticas.",
            velocityBenefitLabel: "Aula sintética",
            velocityBenefitText: "Benefício sintético.",
        };

        try {
            await writeFile(inputPath, "NOME,TELEFONE\nSynthetic Guest,5511999990000\n", "utf8");
            await writeFile(campaignPath, JSON.stringify(campaign), "utf8");
            const result = spawnSync(
                process.execPath,
                [
                    "--import", "tsx",
                    "scripts/beauty-movement-import.ts",
                    "--dry-run",
                    "--input", inputPath,
                    "--campaign", `cli-test-${randomUUID().slice(0, 8)}`,
                    "--campaign-config", campaignPath,
                    "--campaign-ends-at", endsAt,
                ],
                { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
            );
            assert.equal(result.error, undefined, result.error?.message);
            assert.equal(result.status, 0, result.stderr);
            const summary = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
            assert.equal(summary.mode, "dry_run");
            assert.equal(summary.preflight, "complete");
            assert.equal(summary.acceptedRows, 1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

test("modern imports may omit reward_id and defer the commercial outcome to the card resolver", async () => {
    const csv = [
        "invite_ref,name,whatsapp,email,palette,velocity_benefit,expires_at",
        `nh-modern,Ana Silva,51999991234,,radiancia,none,${EXPIRES}`,
    ].join("\n");
    const validation = validateBeautyMovementImport({ csv, nowMs: NOW });
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.equal(validation.rows[0]?.rewardId, null);

    const plan = await prepareBeautyMovementImport({
        csv,
        campaignId: "nh-modern",
        campaignConfig: validCampaignConfig(),
        campaignEndsAtMs: Date.parse("2026-09-01T00:00:00Z"),
        tokenHmacKey: TOKEN_KEY,
        piiKey: PII_KEY,
        nowMs: NOW,
    });
    assert.equal(plan.rewards.length, 0);
    assert.equal(plan.invites[0]?.rewardId, null);
    const sql = buildBeautyMovementImportSql(plan);
    assert.match(sql, /palette\, reward_id, velocity_benefit/);
    assert.match(sql, /'radiancia', NULL, 'none'/);
    assert.doesNotMatch(sql, /Lavieen/);
});

test("beauty movement import writes encrypted D1 rows and reserves raw delivery data for the private CSV", async () => {
    const plan = await prepareBeautyMovementImport({
        csv: validCsv(),
        campaignId: "nh-3-anos",
        campaignConfig: validCampaignConfig(),
        campaignEndsAtMs: Date.parse("2026-09-01T00:00:00Z"),
        rewardCatalog: REWARDS,
        procedureCatalog: PROCEDURES,
        tokenHmacKey: TOKEN_KEY,
        piiKey: PII_KEY,
        nowMs: NOW,
    });
    const inviteUrl = plan.deliveryRows[0]!.inviteUrl;
    const token = inviteUrl.slice(inviteUrl.indexOf("#c=") + 3);
    const sql = buildBeautyMovementImportSql(plan);

    assert.equal(inviteUrl.startsWith("https://espacofacial.com/beleza-em-movimento#c="), true);
    assert.equal(sql.includes("Ana Silva"), false);
    assert.equal(sql.includes("ana@example.com"), false);
    assert.equal(sql.includes("+5551999991234"), false);
    assert.equal(sql.includes(token), false);
    assert.equal(sql.includes("aula_cortesia_evento"), true);
    assert.equal(sql.includes("bm_rewards"), true);
    assert.equal(sql.includes("Lavieen"), true);
    assert.equal(sql.includes("reward_id"), true);
    assert.equal(sql.includes("Beleza que se move com você."), true);
    assert.doesNotMatch(sql, /\bBEGIN(?:\s+IMMEDIATE)?\b/i);
    assert.doesNotMatch(sql, /\bCOMMIT\b/i);
    assert.equal(sql.includes("WHERE bm_campaigns.status = 'draft'"), true);
    assert.match(sql, /WHEN bm_invites\.invite_status = 'revoked' OR excluded\.invite_status = 'revoked' THEN 'revoked'/);
    assert.match(sql, /WHERE bm_invites\.confirmed_at_ms IS NULL/);
    assert.match(sql, /SELECT status FROM bm_campaigns WHERE id = excluded\.campaign_id\) = 'draft'/);

    const deliveryCsv = serializeBeautyMovementDeliveryCsv(plan.deliveryRows);
    assert.match(deliveryCsv, /^name,invite_ref,whatsapp,invite_url\n/);
    assert.equal(deliveryCsv.includes("Ana Silva"), true);
    assert.equal(deliveryCsv.includes("+5551999991234"), true);
    assert.equal(deliveryCsv.includes(inviteUrl), true);
});

test("beauty movement campaign config must be complete and cannot start after its campaign ends", async () => {
    assert.throws(
        () => validateBeautyMovementCampaignConfig({ title: "incompleta" }),
        /beauty_movement_campaign_config_invalid/,
    );

    await assert.rejects(
        () => prepareBeautyMovementImport({
            csv: validCsv(),
            campaignId: "nh-3-anos",
            campaignConfig: validCampaignConfig(),
            campaignEndsAtMs: Date.parse("2026-08-09T00:00:00Z"),
            rewardCatalog: REWARDS,
            procedureCatalog: PROCEDURES,
            tokenHmacKey: TOKEN_KEY,
            piiKey: PII_KEY,
            nowMs: NOW,
        }),
        /beauty_movement_campaign_start_after_end/,
    );
});

test("reward catalog enforces canonical procedures, family and discount shape", () => {
    const mismatchedFamily = validateBeautyMovementImport({
        csv: validCsv(),
        rewardCatalog: [{ ...REWARDS[0]!, family: "ritmo" }],
        nowMs: NOW,
    });
    assert.equal(mismatchedFamily.ok, false);
    if (!mismatchedFamily.ok) assert.equal(mismatchedFamily.issues.some((entry) => entry.code === "reward_family_mismatch"), true);

    assert.throws(
        () => validateBeautyMovementRewardCatalog({
            catalog: [{
                ...REWARDS[0]!,
                rewardId: "rad-lavieen-discount",
                type: "discount",
                discount: { kind: "percent", value: 120, currency: "BRL" },
            }],
            procedureCatalog: PROCEDURES,
        }),
        /beauty_movement_reward_discount_invalid/,
    );

    assert.throws(
        () => validateBeautyMovementRewardCatalog({
            catalog: [{ ...REWARDS[0]!, procedureName: "Botox" }],
            procedureCatalog: PROCEDURES,
        }),
        /beauty_movement_reward_procedure_invalid/,
    );
});

test("D1 migrations preserve the structured reward-to-palette invariant", async () => {
    const migration = await readFile(new URL("../migrations/beauty-movement/0003_reward_integrity.sql", import.meta.url), "utf8");
    assert.match(migration, /bm_invites_reward_matches_palette_insert/);
    assert.match(migration, /bm_invites_reward_matches_palette_update/);
    assert.match(migration, /reward\.campaign_id = NEW\.campaign_id/);
    assert.match(migration, /reward\.family = NEW\.palette/);
    assert.match(migration, /bm_rewards_prevent_referenced_delete/);
    const outcomeMigration = await readFile(new URL("../migrations/beauty-movement/0004_card_outcomes.sql", import.meta.url), "utf8");
    assert.match(outcomeMigration, /outcome_key/);
    assert.match(outcomeMigration, /outcome_snapshot_json/);
    assert.match(outcomeMigration, /outcome_protocol_version/);
});
