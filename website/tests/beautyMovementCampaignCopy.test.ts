import assert from "node:assert/strict";
import test from "node:test";
import {
    buildBeautyMovementCampaignDescriptionUpdateSql,
    validateBeautyMovementCampaignConfig,
} from "@/lib/beautyMovementImport";

const campaignConfig = {
    title: "Beleza que se move com você",
    description: "3 anos. 3 cartas. Um novo movimento para celebrar tudo o que ainda vem pela frente.",
    invitationTitle: "Seu convite para celebrar",
    invitationText: "Uma leitura especial para este encontro.",
    partnerName: "Velocity",
    whatsappMessageCourtesy: "Olá!",
    whatsappMessageCommercial: "Olá!",
    whatsappLabel: "Falar com a equipe no WhatsApp",
    conditionsLabel: "Ler condições da campanha",
    conditionsText: "Condições da campanha.",
    velocityBenefitLabel: "Benefício",
    velocityBenefitText: "Um benefício especial.",
};

test("campaign copy update validates the private copy contract", () => {
    const config = validateBeautyMovementCampaignConfig(campaignConfig);
    assert.equal(config.description, campaignConfig.description);
    assert.equal(config.startsAtMs, null);
});

test("campaign copy update is restricted to the active campaign description", () => {
    const sql = buildBeautyMovementCampaignDescriptionUpdateSql({
        campaignId: "beauty-movement-20260822-live-4",
        description: "O'novo movimento",
        campaignEndsAtMs: Date.parse("2026-12-31T23:59:59Z"),
        updatedAtMs: 1_756_000_000_000,
    });

    assert.match(sql, /UPDATE bm_campaigns SET description = 'O''novo movimento'/);
    assert.match(sql, /updated_at_ms = 1756000000000/);
    assert.match(sql, /WHERE id = 'beauty-movement-20260822-live-4'/);
    assert.match(sql, /status = 'active'/);
    assert.match(sql, /ends_at_ms = 1798761599000/);
    assert.doesNotMatch(sql, /title\s*=|invitation_title|partner_name|bm_invites/);
});
