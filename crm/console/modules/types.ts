import type { ComponentType, ReactNode } from 'react'

export type ModuleAvailability = { available: boolean; reason?: string }

export type ModuleAccessContext = {
  role: unknown
  allowedModules: unknown
  enabledModuleKeys: ReadonlySet<string>
  financeEnabled: boolean
}

export type CrmModuleManifest = {
  key: string
  label: string
  icon: ReactNode
  permissions: readonly string[]
  loader: () => Promise<{ default: ComponentType }>
  fallback: { loadingLabel: string; unavailableLabel: string }
}
