import { Buffer } from 'node:buffer'

import {
  assertAtendimentoProjectionDeltaBatch,
  assertAtendimentoProjectionExportTarget,
  digestAtendimentoProjectionDeltaBatch,
} from './atendimentoProjectionDeltaExporter.mjs'
import {
  assertAtendimentoProjectionDeltaDelivery,
  ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION,
} from './atendimentoProjectionDeltaDelivery.mjs'

export const ATENDIMENTO_CRM_PROJECTION_DELTA_HTTP_TRANSPORT_VERSION = 'atendimento/crm-core/projection-delta-http-transport/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_HTTP_MAX_BODY_BYTES = 64 * 1024
const RECEIPT_VERSION = 'crm-core/projection-delta-receipt/v1'
const REQUEST_ID_PATTERN = /^crm-atendimento-delta-\d{6,16}$/
const TRANSPORT_TIMEOUT = Symbol('ATENDIMENTO_CRM_PROJECTION_DELTA_TRANSPORT_TIMEOUT')

function fail(code) { throw new Error(code) }
function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value
}
function text(value, code) {
  const normalized = String(value ?? '').trim()
  if (!normalized) fail(code)
  return normalized
}
function requestId(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_REQUEST_ID_INVALID')
  if (!REQUEST_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_REQUEST_ID_INVALID')
  return normalized
}
function endpoint(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ENDPOINT_INVALID')
  let parsed
  try { parsed = new URL(normalized) } catch { fail('ATENDIMENTO_CRM_PROJECTION_DELTA_ENDPOINT_INVALID') }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/crm/_internal/delta/atendimento'
    || parsed.search || parsed.hash || parsed.username || parsed.password) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_ENDPOINT_INVALID')
  return parsed.toString()
}
function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}
function timeout(value) {
  const normalized = value === undefined ? 15_000 : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 60_000) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_TIMEOUT_INVALID')
  return normalized
}
function withAbortDeadline(value, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(TRANSPORT_TIMEOUT)
      return
    }
    const abort = () => {
      cleanup()
      reject(TRANSPORT_TIMEOUT)
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(value).then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
function receipt(value, { batch, requestId: expectedRequestId }) {
  const payload = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_RESPONSE_INVALID')
  const target = assertAtendimentoProjectionExportTarget(payload.target)
  if (Object.keys(payload).length !== 9 || !Object.hasOwn(payload, 'ok') || !Object.hasOwn(payload, 'contractVersion') || !Object.hasOwn(payload, 'status') || !Object.hasOwn(payload, 'batchId') || !Object.hasOwn(payload, 'eventCount') || !Object.hasOwn(payload, 'target') || !Object.hasOwn(payload, 'requestId') || !Object.hasOwn(payload, 'fromExclusive') || !Object.hasOwn(payload, 'toInclusive')) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RESPONSE_INVALID')
  if (payload.ok !== true || payload.contractVersion !== RECEIPT_VERSION || !['accepted', 'idempotent'].includes(payload.status) || payload.batchId !== batch.batchId || payload.eventCount !== batch.events.length || payload.requestId !== expectedRequestId || payload.fromExclusive !== batch.sourceDelta.fromExclusive || payload.toInclusive !== batch.sourceDelta.toInclusive || !sameTarget(target, batch.target)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RESPONSE_INVALID')
  return Object.freeze({ ok: true, contractVersion: RECEIPT_VERSION, status: payload.status, batchId: payload.batchId, eventCount: payload.eventCount, target, requestId: expectedRequestId, fromExclusive: payload.fromExclusive, toInclusive: payload.toInclusive })
}

export function createAtendimentoProjectionDeltaHttpTransport({ endpoint: suppliedEndpoint, fetch: fetchImpl, timeoutMs: suppliedTimeoutMs } = {}) {
  const targetEndpoint = endpoint(suppliedEndpoint)
  if (typeof fetchImpl !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_FETCH_REQUIRED')
  const timeoutMs = timeout(suppliedTimeoutMs)
  return Object.freeze({
    version: ATENDIMENTO_CRM_PROJECTION_DELTA_HTTP_TRANSPORT_VERSION,
    endpoint: targetEndpoint,
    async deliver(value) {
      const input = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_TRANSPORT_INPUT_INVALID')
      if (Object.keys(input).length !== 3 || !Object.hasOwn(input, 'batch') || !Object.hasOwn(input, 'delivery') || !Object.hasOwn(input, 'requestId')) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_TRANSPORT_INPUT_INVALID')
      const batch = assertAtendimentoProjectionDeltaBatch(input.batch)
      const delivery = assertAtendimentoProjectionDeltaDelivery(input.delivery)
      const id = requestId(input.requestId)
      if (delivery.contract !== ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION || delivery.batchDigest !== digestAtendimentoProjectionDeltaBatch(batch)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_MISMATCH')
      const body = JSON.stringify({ batch, delivery })
      if (Buffer.byteLength(body, 'utf8') > ATENDIMENTO_CRM_PROJECTION_DELTA_HTTP_MAX_BODY_BYTES) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BODY_TOO_LARGE')
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), timeoutMs)
      try {
        let response
        try {
          response = await withAbortDeadline(fetchImpl(targetEndpoint, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: Object.freeze({ 'content-type': 'application/json', 'x-request-id': id }), body, signal: controller.signal }), controller.signal)
        } catch (error) {
          if (error === TRANSPORT_TIMEOUT) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_TIMEOUT')
          fail('ATENDIMENTO_CRM_PROJECTION_DELTA_UNAVAILABLE')
        }
        if (!response || response.status !== 200 || typeof response.json !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_REJECTED')
        let payload
        try {
          // Fetch may resolve once headers arrive while a malicious or broken
          // peer keeps the JSON body open forever. Keep the one transport
          // deadline around the body read as well as the connection.
          payload = await withAbortDeadline(response.json(), controller.signal)
        } catch (error) {
          if (error === TRANSPORT_TIMEOUT) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_TIMEOUT')
          fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RESPONSE_INVALID')
        }
        return receipt(payload, { batch, requestId: id })
      } finally { clearTimeout(deadline) }
    },
  })
}

export const __testables = Object.freeze({ endpoint, requestId, sameTarget, receipt })
