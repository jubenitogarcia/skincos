const NONCE_STATE_KEY = 'schedule-public-read-nonce'

function validExpiry(value, now) {
  return Number.isSafeInteger(value)
    && value > now
    && value <= now + (15 * 60 * 1000)
}

/**
 * One Durable Object is deterministically assigned to every authenticated
 * nonce. Durable Object event serialization makes consuming that nonce an
 * atomic operation, so a duplicated signed request cannot pass concurrently.
 */
export class SchedulePublicReadNonceGuard {
  constructor(state) {
    this.state = state
  }

  async consume({ expiresAt, now = Date.now() } = {}) {
    if (!validExpiry(expiresAt, now)) return { ok: false, code: 'INVALID_EXPIRY' }

    const previousExpiry = await this.state.storage.get(NONCE_STATE_KEY)
    if (Number.isSafeInteger(previousExpiry) && previousExpiry > now) {
      return { ok: false, code: 'REPLAYED' }
    }

    await this.state.storage.put(NONCE_STATE_KEY, expiresAt)
    await this.state.storage.setAlarm(expiresAt)
    return { ok: true }
  }

  async alarm() {
    await this.state.storage.delete(NONCE_STATE_KEY)
  }
}

export const __testables = { NONCE_STATE_KEY, validExpiry }
