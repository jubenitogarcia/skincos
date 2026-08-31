export const SCHEDULE_PUBLIC_READ_NONCE_STATE_KEY = 'schedule-public-read-nonce'

export function validSchedulePublicReadNonceExpiry(value, now) {
  return Number.isSafeInteger(value)
    && value > now
    && value <= now + (15 * 60 * 1000)
}

export async function consumeSchedulePublicReadNonce(storage, {
  expiresAt,
  now = Date.now(),
} = {}) {
  if (!storage || !validSchedulePublicReadNonceExpiry(expiresAt, now)) {
    return { ok: false, code: 'INVALID_EXPIRY' }
  }

  const previousExpiry = await storage.get(SCHEDULE_PUBLIC_READ_NONCE_STATE_KEY)
  if (Number.isSafeInteger(previousExpiry) && previousExpiry > now) {
    return { ok: false, code: 'REPLAYED' }
  }

  await storage.put(SCHEDULE_PUBLIC_READ_NONCE_STATE_KEY, expiresAt)
  await storage.setAlarm(expiresAt)
  return { ok: true }
}

export async function clearSchedulePublicReadNonce(storage) {
  await storage.delete(SCHEDULE_PUBLIC_READ_NONCE_STATE_KEY)
}
