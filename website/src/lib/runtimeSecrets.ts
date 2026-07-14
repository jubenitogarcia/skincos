import { getCloudflareContext } from "@opennextjs/cloudflare";

function normalizeSecret(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function getRuntimeSecret(name: string): Promise<string> {
    const fromProcess = normalizeSecret(process.env[name]);
    if (fromProcess) return fromProcess;

    try {
        const { env } = await getCloudflareContext({ async: true });
        return normalizeSecret((env as Record<string, unknown> | undefined)?.[name]);
    } catch {
        return "";
    }
}
