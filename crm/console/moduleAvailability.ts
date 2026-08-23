import localLaunchCatalog from './modules/localLaunchCatalog.json'

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

// Ponto remains self-service for authenticated Workforce identities. Role and
// server authorization still constrain what each identity can do inside it.
// The neutral catalog is shared with the Windows/WSL launcher discovery CLI.
export const DEFAULT_UNLOCKED_MODULE_KEYS: readonly string[] = Object.freeze(
  localLaunchCatalog.modules.map((entry) => entry.key),
)

export function unlockedModuleKeys(
  defaultModuleKey: string,
  isOnline: boolean,
  localFocusModule = '',
): Set<string> {
  const focused = String(localFocusModule || '').trim()
  if (!isOnline && focused) {
    return new Set(DEFAULT_UNLOCKED_MODULE_KEYS.includes(focused) ? [focused] : [])
  }
  const candidates = [defaultModuleKey, ...DEFAULT_UNLOCKED_MODULE_KEYS]
  return new Set(candidates.filter((key) => !isOnline || !ONLINE_DISABLED_MODULE_KEYS.has(key)))
}

export function isOnlineCrmRuntime(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
}
