type FinanceBootstrapPayload = {
  moduleEnabled?: boolean
  canAccess?: boolean
}

type FinanceBootstrapOptions = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  attempts?: number
  retryDelayMs?: number
  apiOrigin?: string
  wait?: (delayMs: number) => Promise<void>
}

const pause = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs))

export async function resolveFinanceBootstrapEnabled({
  fetchImpl = fetch,
  signal,
  attempts = 3,
  retryDelayMs = 400,
  apiOrigin = '/api',
  wait = pause,
}: FinanceBootstrapOptions = {}): Promise<boolean> {
  const totalAttempts = Math.max(1, Math.min(5, Math.trunc(attempts)))
  const target = `${String(apiOrigin || '/api').replace(/\/$/, '')}/finance/bootstrap`

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (signal?.aborted) return false
    try {
      const response = await fetchImpl(target, { credentials: 'include', signal })
      if (response.ok) {
        const payload = await response.json().catch(() => null) as FinanceBootstrapPayload | null
        return Boolean(payload?.moduleEnabled && payload?.canAccess)
      }
      if (response.status < 500) return false
    } catch {
      if (signal?.aborted) return false
    }
    if (attempt + 1 < totalAttempts) await wait(retryDelayMs * (attempt + 1))
  }
  return false
}
