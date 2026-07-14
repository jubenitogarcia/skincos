export function parseGbpLocationId(input: string): string | null {
    const raw = (input ?? "").trim();
    if (!raw || raw.startsWith("accounts/")) return null;

    const id = raw.startsWith("locations/")
        ? raw.slice("locations/".length).trim()
        : raw;

    return /^\d+$/.test(id) ? id : null;
}

export function buildGbpLocationResource(accountId: string, locationId: string): string {
    if (!/^\d+$/.test(accountId) || !/^\d+$/.test(locationId)) {
        throw new Error("invalid_gbp_resource_identifier");
    }

    return `accounts/${accountId}/locations/${locationId}`;
}
