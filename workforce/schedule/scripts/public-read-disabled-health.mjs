export const DISABLED_STAGING_SMOKE_MAX_WAIT_MS = 30_000
export const DISABLED_STAGING_SMOKE_RETRY_DELAY_MS = 1_000
export const DISABLED_STAGING_SMOKE_REQUEST_TIMEOUT_MS = 15_000

const transientNetworkCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
}

function transientNetworkCode(error) {
  let current = error
  for (let depth = 0; current && depth < 3; depth += 1) {
    const code = String(current.code || '')
    if (transientNetworkCodes.has(code)) return code
    current = current.cause
  }
  return null
}

export function isTransientDisabledHealthError(error) {
  const name = String(error?.name || '')
  if (name === 'AbortError' || name === 'TimeoutError') return true
  if (transientNetworkCode(error)) return true
  return name === 'TypeError'
    && /(?:fetch failed|network(?:\s+error)?|socket|connection (?:reset|refused)|request timed out|timed out)/i.test(String(error?.message || ''))
}

function describeTransientError(error) {
  const code = transientNetworkCode(error)
  if (code) return `network ${code}`
  const name = String(error?.name || '')
  return name === 'AbortError' || name === 'TimeoutError' ? name : 'network error'
}

function convergenceError({ attempts, lastTransient, maxWaitMs }) {
  return new Error(
    `disabled Schedule public-read health did not converge to 503 within ${maxWaitMs}ms after ${attempts} attempts (last transient: ${lastTransient})`,
  )
}

export async function assertDisabledSchedulePublicReadHealth(response) {
  if (response?.status !== 503) {
    throw new Error(`disabled Schedule public-read health returned HTTP ${response?.status ?? 'unknown'}; expected 503`)
  }

  const body = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw new Error('disabled Schedule public-read health must return JSON')
  }
  if (body.ok !== false) {
    throw new Error('disabled Schedule public-read health must return ok=false')
  }
  if (body.error !== 'SCHEDULE_PUBLIC_READ_UNAVAILABLE') {
    throw new Error('disabled Schedule public-read health returned an unexpected error code')
  }
  return response
}

export async function waitForDisabledSchedulePublicReadHealth({
  request,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxWaitMs = DISABLED_STAGING_SMOKE_MAX_WAIT_MS,
  retryDelayMs = DISABLED_STAGING_SMOKE_RETRY_DELAY_MS,
  requestTimeoutMs = DISABLED_STAGING_SMOKE_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof request !== 'function') throw new Error('disabled Schedule public-read health request is required')
  if (typeof now !== 'function') throw new Error('disabled Schedule public-read health clock is required')
  if (typeof sleep !== 'function') throw new Error('disabled Schedule public-read health sleep is required')
  requirePositiveInteger(maxWaitMs, 'disabled Schedule public-read health maxWaitMs')
  requirePositiveInteger(retryDelayMs, 'disabled Schedule public-read health retryDelayMs')
  requirePositiveInteger(requestTimeoutMs, 'disabled Schedule public-read health requestTimeoutMs')

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
      if (response?.status === 503) return assertDisabledSchedulePublicReadHealth(response)
      if (response?.status !== 404) {
        throw new Error(`disabled Schedule public-read health returned HTTP ${response?.status ?? 'unknown'}; expected 503`)
      }
      lastTransient = 'HTTP 404'
    }

    const remainingBeforeRetry = deadline - now()
    if (remainingBeforeRetry <= 0) {
      throw convergenceError({ attempts, lastTransient, maxWaitMs })
    }
    await sleep(Math.min(retryDelayMs, remainingBeforeRetry))
  }
}
