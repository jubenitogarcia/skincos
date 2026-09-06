/**
 * Public, read-only contract for the next Roda da Beleza campaign.
 *
 * This module deliberately carries no commercial catalogue, personal data,
 * runtime configuration, or infrastructure dependency. A campaign may only
 * become available after its approved source, dedicated data store, and
 * activation checks are introduced in a separate change.
 */
export const RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION = "roda-da-beleza-public/v1" as const;

export type RodaDaBelezaPublicOfferV1 = {
    code: string;
    title: string;
    description: string;
    termsVersion: string;
};

export type RodaDaBelezaPublicCampaignV1 = {
    id: "roda-da-beleza";
    title: string;
    termsVersion: string;
    capabilities: {
        catalog: true;
        enrollment: false;
        award: false;
    };
    offers: readonly RodaDaBelezaPublicOfferV1[];
};

export type RodaDaBelezaPublicCampaignUnavailableV1 = {
    ok: false;
    contractVersion: typeof RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION;
    error: "campaign_unavailable";
};

export type RodaDaBelezaPublicCampaignAvailableV1 = {
    ok: true;
    contractVersion: typeof RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION;
    campaign: RodaDaBelezaPublicCampaignV1;
};

export type RodaDaBelezaPublicCampaignResponseV1 =
    | RodaDaBelezaPublicCampaignUnavailableV1
    | RodaDaBelezaPublicCampaignAvailableV1;

/**
 * The absence of a campaign is intentional. Do not source this from an
 * environment variable or legacy wheel data: availability must eventually be
 * resolved from the approved, dedicated campaign service.
 */
export function readRodaDaBelezaPublicCampaignV1(): RodaDaBelezaPublicCampaignV1 | null {
    return null;
}

export function rodaDaBelezaCampaignUnavailableV1(): RodaDaBelezaPublicCampaignUnavailableV1 {
    return {
        ok: false,
        contractVersion: RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION,
        error: "campaign_unavailable",
    };
}
