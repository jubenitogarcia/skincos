export const LEGACY_KEY_ID = "legacy-v1";

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function keyId(value, label = "coordination key id") {
  const normalized = String(value || "").trim();
  if (!KEY_ID.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function secret(value) {
  return String(value || "").trim();
}

function truthy(value, fallback = false) {
  const normalized = String(value ?? (fallback ? "true" : "false")).trim().toLowerCase();
  return normalized === "true";
}

export function keyRingFor(env, { recovery = false, now = Date.now() } = {}) {
  const prefix = recovery ? "COORDINATION_RECOVERY" : "COORDINATION";
  const sharedSecret = secret(env.COORDINATION_SHARED_SECRET);
  const configuredActiveSecret = recovery
    ? secret(env[`${prefix}_ACTIVE_KEY`] || env[`${prefix}_SECRET`])
    : secret(env[`${prefix}_ACTIVE_KEY`]);
  const activeSecret = configuredActiveSecret || sharedSecret;
  const activeId = String(
    env[`${prefix}_ACTIVE_KEY_ID`] || (recovery ? env.COORDINATION_RECOVERY_KEY_ID || "recovery-v1" : LEGACY_KEY_ID),
  ).trim();
  if (!activeSecret || !activeId) return null;
  if (!recovery && configuredActiveSecret && activeId === LEGACY_KEY_ID) return null;

  const active = { id: keyId(activeId), secret: activeSecret };
  const previousId = String(env[`${prefix}_PREVIOUS_KEY_ID`] || "").trim();
  const previousExpiresAt = Date.parse(String(env[`${prefix}_PREVIOUS_KEY_EXPIRES_AT`] || ""));
  const explicitPreviousSecret = secret(env[`${prefix}_PREVIOUS_KEY`]);
  // During the first rotation, the old canonical shared secret may still be
  // available while the new active key is introduced. Treat it as the
  // previous key only when the caller pins both its ID and expiry. This lets
  // old clients drain safely without requiring the old secret to be copied
  // into a second custody slot by hand.
  const inheritedPreviousSecret = !recovery && configuredActiveSecret && sharedSecret && previousId && !explicitPreviousSecret
    ? sharedSecret
    : "";
  const previousSecret = explicitPreviousSecret || inheritedPreviousSecret;
  const previous = previousSecret && previousId && Number.isFinite(previousExpiresAt) && previousExpiresAt > now
    ? { id: keyId(previousId), secret: previousSecret, expiresAt: previousExpiresAt }
    : null;
  const legacyCompatibilityEnabled = !recovery && truthy(env.COORDINATION_ALLOW_LEGACY_KEY, true);
  return {
    active,
    previous,
    // No-key-id requests are accepted only for the original legacy active
    // key, or for a bounded first-rotation grace where the previous key is
    // explicitly legacy and unpinned callers can still drain.
    allowLegacyWithoutKeyId: legacyCompatibilityEnabled && active.id === LEGACY_KEY_ID,
    allowUnpinnedKeyDuringGrace: legacyCompatibilityEnabled && previous?.id === LEGACY_KEY_ID,
  };
}

export function keyCandidatesForRequest(ring, requestedKeyId) {
  if (!ring) return [];
  const normalized = String(requestedKeyId || "").trim();
  if (normalized) {
    const candidateId = keyId(normalized);
    if (candidateId === ring.active.id) return [ring.active];
    if (ring.previous?.id === candidateId) return [ring.previous];
    return [];
  }
  if (ring.allowLegacyWithoutKeyId) return [ring.active];
  if (ring.allowUnpinnedKeyDuringGrace) return [ring.active, ring.previous].filter(Boolean);
  return [];
}

export function keyForRequest(ring, requestedKeyId) {
  return keyCandidatesForRequest(ring, requestedKeyId)[0] || null;
}
