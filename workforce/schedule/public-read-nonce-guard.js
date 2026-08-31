import { DurableObject } from 'cloudflare:workers'

import {
  clearSchedulePublicReadNonce,
  consumeSchedulePublicReadNonce,
} from './public-read-nonce-state.js'

/**
 * One Durable Object is deterministically assigned to every authenticated
 * nonce. Durable Object event serialization makes consuming that nonce an
 * atomic operation, so a duplicated signed request cannot pass concurrently.
 */
export class SchedulePublicReadNonceGuard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
  }

  async consume({ expiresAt } = {}) {
    return consumeSchedulePublicReadNonce(this.ctx.storage, { expiresAt })
  }

  async alarm() {
    await clearSchedulePublicReadNonce(this.ctx.storage)
  }
}
