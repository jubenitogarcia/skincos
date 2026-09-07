import { Buffer } from 'node:buffer'

import {
  assertAtendimentoProjectionBackfillBatch,
  assertAtendimentoProjectionExportTarget,
  digestAtendimentoProjectionBackfillBatch,
} from './atendimentoProjectionExporter.mjs'
import {
  ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION,
  assertAtendimentoProjectionBackfillDelivery,
} from './atendimentoProjectionBackfillDelivery.mjs'

export const ATENDIMENTO_CRM_BACKFILL_HTTP_PATH = '/_internal/crm/backfill/atendimento'
export const ATENDIMENTO_CRM_BACKFILL_HTTP_MAX_BODY_BYTES = 64 * 1024
export const ATENDIMENTO_CRM_BACKFILL_RECEIPT_VERSION = 'crm-core/projection-backfill-receipt/v1'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const OUTCOMES = new Set(['accepted', 'idempotent'])

function fail(code) {
  throw new Error(code)
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value
}

function exactKeys(value, keys, code) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code)
}

function requestId(value) {
  const normalized = String(value || '').trim()
  if (!REQUEST_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_REQUEST_ID_INVALID')
  return normalized
}

function endpoint(value) {
  let parsed
  try {
    parsed = new URL(String(value || '').trim())
  } catch {
    fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_ENDPOINT_INVALID')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== ATENDIMENTO_CRM_BACKFILL_HTTP_PATH
    || parsed.search
    || parsed.hash
  ) fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_ENDPOINT_INVALID')
  return parsed.toString()
}

function sameTarget(left, right) {
  return left.environment === right.environment
    && left.release === right.release
    && left.artifactDigest === right.artifactDigest
}

function responseReceipt(value, { batch, requestId: expectedRequestId }) {
  const receipt = object(value, 'ATENDIMENTO_CRM_BACKFILL_TRANSPORT_RESPONSE_INVALID')
  exactKeys(receipt, ['ok', 'contractVersion', 'status', 'batchId', 'eventCount', 'target', 'requestId'], 'ATENDIMENTO_CRM_BACKFILL_TRANSPORT_RESPONSE_INVALID')
  const target = assertAtendimentoProjectionExportTarget(receipt.target)
  if (
    receipt.ok !== true
    || receipt.contractVersion !== ATENDIMENTO_CRM_BACKFILL_RECEIPT_VERSION
    || !OUTCOMES.has(receipt.status)
    || receipt.batchId !== batch.batchId
    || receipt.eventCount !== batch.events.length
    || receipt.requestId !== expectedRequestId
    || !sameTarget(target, batch.target)
  ) fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_RESPONSE_INVALID')
  return Object.freeze({
    ok: true,
    contractVersion: ATENDIMENTO_CRM_BACKFILL_RECEIPT_VERSION,
    status: receipt.status,
    batchId: batch.batchId,
    eventCount: batch.events.length,
    target,
    requestId: expectedRequestId,
  })
}

/**
 * Creates an opt-in HTTP transport for the private Worker route. It receives a
 * configured HTTPS endpoint and a caller-supplied fetch implementation; it
 * never reads environment variables, follows redirects, forwards browser
 * credentials, or creates an Authorization/Cookie/Origin header.
 */
export function createAtendimentoProjectionBackfillHttpTransport({
  endpoint: suppliedEndpoint,
  fetch: fetchImpl,
} = {}) {
  const targetEndpoint = endpoint(suppliedEndpoint)
  if (typeof fetchImpl !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_FETCH_REQUIRED')

  return Object.freeze({
    version: 'atendimento/crm-core-projection-backfill-http-transport/v1',
    endpoint: targetEndpoint,
    async deliver(value) {
      const input = object(value, 'ATENDIMENTO_CRM_BACKFILL_TRANSPORT_INPUT_INVALID')
      exactKeys(input, ['batch', 'delivery', 'requestId'], 'ATENDIMENTO_CRM_BACKFILL_TRANSPORT_INPUT_INVALID')
      const batch = assertAtendimentoProjectionBackfillBatch(input.batch)
      const delivery = assertAtendimentoProjectionBackfillDelivery(input.delivery)
      const id = requestId(input.requestId)
      if (
        delivery.contract !== ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION
        || delivery.batchDigest !== digestAtendimentoProjectionBackfillBatch(batch)
      ) {
        // The Core validates the canonical batch digest rather than eventsDigest;
        // this guard only ensures the caller cannot substitute a different proof.
        fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_DELIVERY_MISMATCH')
      }

      const body = JSON.stringify({ batch, delivery })
      if (Buffer.byteLength(body, 'utf8') > ATENDIMENTO_CRM_BACKFILL_HTTP_MAX_BODY_BYTES) {
        fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_BODY_TOO_LARGE')
      }

      let response
      try {
        response = await fetchImpl(targetEndpoint, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: Object.freeze({
            'content-type': 'application/json',
            'x-request-id': id,
          }),
          body,
        })
      } catch {
        fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE')
      }
      if (!response || response.status !== 200 || typeof response.json !== 'function') {
        fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_REJECTED')
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        fail('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_RESPONSE_INVALID')
      }
      return responseReceipt(payload, { batch, requestId: id })
    },
  })
}
