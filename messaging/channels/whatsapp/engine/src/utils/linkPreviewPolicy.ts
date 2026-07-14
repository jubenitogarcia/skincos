type Environment = Record<string, string | undefined>;

/**
 * Link previews cause the WhatsApp client to retrieve URLs contained in message
 * bodies. Keep that network fetch disabled until the operator explicitly opts in.
 */
export function isLinkPreviewEnabled(requested: unknown, environment: Environment = process.env): boolean {
  return environment.ENABLE_LINK_PREVIEW_FETCH === 'true' && (requested === undefined || requested === true);
}
