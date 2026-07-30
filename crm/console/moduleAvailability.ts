import localLaunchCatalog from './modules/localLaunchCatalog.json'

const ONLINE_ENABLED_MODULE_KEYS = new Set(
  localLaunchCatalog.modules
    .filter((entry) => entry.onlineEnabled === true)
    .map((entry) => entry.key),
)
// Finance has a separate release/grant gate in App.tsx and intentionally is
// not part of the local launch catalog.
const ONLINE_SEPARATELY_GATED_MODULE_KEYS = new Set(['finance'])

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
  // This value comes from the authenticated local runtime binding, not from
  // the hostname or a build-time Vite variable. When present it is authoritative
  // even if the loopback service is reached through a local alias/proxy.
  if (focused) {
    return new Set(DEFAULT_UNLOCKED_MODULE_KEYS.includes(focused) ? [focused] : [])
  }
  const candidates = [defaultModuleKey, ...DEFAULT_UNLOCKED_MODULE_KEYS]
  return new Set(candidates.filter((key) => (
    !isOnline ||
    ONLINE_ENABLED_MODULE_KEYS.has(key) ||
    ONLINE_SEPARATELY_GATED_MODULE_KEYS.has(key)
  )))
}

export function isOnlineCrmRuntime(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
}
