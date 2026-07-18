const json = (status: number, payload: Record<string, unknown>) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const envValue = (context: any, key: string) => {
  const value = context?.env?.[key] ?? (typeof process !== 'undefined' ? (process as any)?.env?.[key] : undefined)
  return String(value || '').trim()
}

const numberValue = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export const onRequestGet = (context: any) => {
  const sessionId = envValue(context, 'LOCAL_RUNTIME_SESSION_ID')
  if (!sessionId) {
    return json(503, { ok: false, reason: 'LOCAL_RUNTIME_IDENTITY_NOT_CONFIGURED' })
  }
  const waPort = numberValue(envValue(context, 'LOCAL_RUNTIME_WA_PORT'))
  const waMode = envValue(context, 'LOCAL_RUNTIME_WA_MODE') || 'disabled'
  const localStub = envValue(context, 'LOCAL_RUNTIME_WA_LOCAL_STUB') === 'true'
  return json(200, {
    ok: true,
    sessionId,
    worktree: envValue(context, 'LOCAL_RUNTIME_WORKTREE'),
    commit: envValue(context, 'LOCAL_RUNTIME_COMMIT'),
    fingerprint: envValue(context, 'LOCAL_RUNTIME_FINGERPRINT'),
    activeModule: envValue(context, 'LOCAL_RUNTIME_MODULE') || null,
    startedAt: envValue(context, 'LOCAL_RUNTIME_STARTED_AT'),
    ports: {
      pages: numberValue(envValue(context, 'LOCAL_RUNTIME_PAGES_PORT')),
      vite: numberValue(envValue(context, 'LOCAL_RUNTIME_VITE_PORT')),
      whatsappAdapter: waPort,
      insumos: numberValue(envValue(context, 'LOCAL_RUNTIME_INSUMOS_PORT')),
    },
    whatsapp: {
      mode: waMode,
      localStub,
      effectiveTarget: envValue(context, 'LOCAL_RUNTIME_WA_TARGET') || null,
    },
    localStub,
  })
}
