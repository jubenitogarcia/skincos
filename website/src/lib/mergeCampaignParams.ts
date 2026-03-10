import { CAMPAIGN_PARAM_KEYS } from "@/lib/campaign";

export function mergeCampaignParamsIntoUrl(destinationUrl: string, requestUrl: string): string {
    const incoming = new URL(requestUrl);
    const destination = new URL(destinationUrl);

    for (const key of CAMPAIGN_PARAM_KEYS) {
        const value = incoming.searchParams.get(key);
        if (!value) continue;

        const trimmed = value.trim();
        if (!trimmed) continue;

        // Don't override any destination-provided values.
        if (!destination.searchParams.has(key)) {
            destination.searchParams.set(key, trimmed);
        }
    }

    return destination.toString();
}
