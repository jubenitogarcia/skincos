import { buildWhatsappRedirectHref } from "@/lib/whatsappTracking";

/**
 * WhatsApp destination for the Beauty Movement campaign.
 *
 * This campaign destination is intentionally kept separate from the site's
 * legacy phone aliasing rules. The invite CTA must open the number supplied by
 * the campaign owner exactly as configured.
 */
export const BEAUTY_MOVEMENT_WHATSAPP_PHONE = "5551995811008" as const;

export type BeautyMovementWhatsappPlacement = "result" | "conditions";

function cleanMessagePart(value: string | null | undefined, maxLength: number): string {
    return (value ?? "")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

/**
 * Creates the only personalized text sent to WhatsApp by this campaign.
 * Values come from the private invite session and the three cards rendered in
 * the result; no token, contact detail, or clinical inference is included.
 */
export function buildBeautyMovementWhatsappMessage(params: {
    displayName?: string | null;
    selectedConcepts?: string | null;
    prize?: string | null;
}): string {
    const name = cleanMessagePart(params.displayName, 120) || "convidado(a)";
    const concepts = cleanMessagePart(params.selectedConcepts, 240) || "as minhas três cartas";
    const prize = cleanMessagePart(params.prize, 600) || "o meu prêmio da campanha";

    return `Olá! Eu sou ${name}. Minha sorte em Beleza em Movimento reuniu ${concepts} e revelou o prêmio: ${prize}. Vim falar com a Espaço Facial para saber como resgatar.`;
}

/**
 * Builds a direct wa.me destination without passing the campaign number
 * through the site's legacy-phone compatibility mapping.
 */
export function buildBeautyMovementWhatsappDestination(message: string): string {
    const url = new URL(`https://wa.me/${BEAUTY_MOVEMENT_WHATSAPP_PHONE}`);
    url.searchParams.set("text", message);
    return url.toString();
}

export function buildBeautyMovementWhatsappHref(params: {
    message: string;
    placement: BeautyMovementWhatsappPlacement;
}): string | null {
    return buildWhatsappRedirectHref({
        rawUrl: buildBeautyMovementWhatsappDestination(params.message),
        tracking: {
            placement: `beauty_movement_${params.placement}`,
            unitSlug: "novo-hamburgo",
            source: "beauty-movement",
            // The redirect identifies the campaign but never receives a
            // location, attribution context, event id, or personal state.
        },
    });
}
