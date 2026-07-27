const ONLINE_DISABLED_MODULE_KEYS = new Set([
  'caixa',
  'faturamento',
  'meta-ads',
  'meta-pages-review',
  'procedimentos',
  'instagram-studio',
  'site-tracking',
  'unit-monitor',
])

export const DEFAULT_UNLOCKED_MODULE_KEYS = [
  'insumos',
  'conversa',
  'atendimento',
  'clientes',
  'caixa',
  'faturamento',
  'procedimentos',
  'unit-monitor',
  'instagram-studio',
  'meta-pages-review',
  'meta-ads',
  'site-tracking',
  'escala-profissionais',
] as const

export function unlockedModuleKeys(defaultModuleKey: string, isOnline: boolean): Set<string> {
  const candidates = [defaultModuleKey, ...DEFAULT_UNLOCKED_MODULE_KEYS]
  return new Set(candidates.filter((key) => !isOnline || !ONLINE_DISABLED_MODULE_KEYS.has(key)))
}

export function isOnlineCrmRuntime(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
}
