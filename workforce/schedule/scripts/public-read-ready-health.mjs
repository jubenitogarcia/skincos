import {
  assertDisabledSchedulePublicReadHealth,
  isTransientDisabledHealthError,
} from './public-read-disabled-health.mjs'

export const READY_STAGING_SMOKE_MAX_WAIT_MS = 30_000
export const READY_STAGING_SMOKE_RETRY_DELAY_MS = 1_000
export const READY_STAGING_SMOKE_REQUEST_TIMEOUT_MS = 15_000

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
}

function describeTransientError(error) {
  const code = String(error?.code || error?.cause?.code || '')
  if (code) return `network ${code}`
  const name = String(error?.name || '')
  return name === 'AbortError' || name === 'TimeoutError' ? name : 'network error'
}

function convergenceError({ attempts, lastTransient, maxWaitMs }) {
  return new Error(
    `ready Schedule public-read health did not converge to 200 within ${maxWaitMs}ms after ${attempts} attempts (last transient: ${lastTransient})`,
  )
}

export async function waitForReadySchedulePublicReadHealth({
  request,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxWaitMs = READY_STAGING_SMOKE_MAX_WAIT_MS,
  retryDelayMs = READY_STAGING_SMOKE_RETRY_DELAY_MS,
  requestTimeoutMs = READY_STAGING_SMOKE_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof request !== 'function') throw new Error('ready Schedule public-read health request is required')
  if (typeof now !== 'function') throw new Error('ready Schedule public-read health clock is required')
  if (typeof sleep !== 'function') throw new Error('ready Schedule public-read health sleep is required')
  requirePositiveInteger(maxWaitMs, 'ready Schedule public-read health maxWaitMs')
  requirePositiveInteger(retryDelayMs, 'ready Schedule public-read health retryDelayMs')
  requirePositiveInteger(requestTimeoutMs, 'ready Schedule public-read health requestTimeoutMs')

  const deadline = now() + maxWaitMs
  let attempts = 0
  let lastTransient = 'none'

  while (true) {
    if (attempts > 0 && now() >= deadline) {
      throw convergenceError({ attempts, lastTransient, maxWaitMs })
    }

    const remainingBeforeRequest = Math.max(1, deadline - now())
    attempts += 1
    let response
    let transientRequestFailure = false

    try {
      response = await request({ timeoutMs: Math.min(requestTimeoutMs, remainingBeforeRequest) })
    } catch (error) {
      if (!isTransientDisabledHealthError(error)) throw error
      transientRequestFailure = true
      lastTransient = describeTransientError(error)
    }

    if (!transientRequestFailure) {
      if (response?.status === 200) return response
      if (response?.status === 503) {
        await assertDisabledSchedulePublicReadHealth(response)
        lastTransient = 'HTTP 503 disabled'
      } else if (response?.status === 404) {
        lastTransient = 'HTTP 404'
      } else {
        throw new Error(`ready Schedule public-read health returned HTTP ${response?.status ?? 'unknown'}; expected 200`)
      }
    }

    const remainingBeforeRetry = deadline - now()
    if (remainingBeforeRetry <= 0) {
      throw convergenceError({ attempts, lastTransient, maxWaitMs })
    }
    await sleep(Math.min(retryDelayMs, remainingBeforeRetry))
  }
}
