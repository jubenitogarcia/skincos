import type { ComponentType, ReactNode } from 'react'

export type ModuleAvailabilityState = 'available' | 'unreleased' | 'maintenance' | 'forbidden'

export type ModuleAvailability = { available: boolean; state: ModuleAvailabilityState; reason?: string }

export type ModuleAccessContext = {
  role: unknown
  allowedModules: unknown
  enabledModuleKeys: ReadonlySet<string>
  grants?: ReadonlySet<string>
  featureFlags?: Readonly<Record<string, boolean>>
  maintenanceModuleKeys?: ReadonlySet<string>
  financeEnabled: boolean
}

export type CrmModuleManifest = {
  key: string
  label: string
  icon: ReactNode
  permissions: readonly string[]
  featureFlag?: string
  requiredGrant?: string
  loader: () => Promise<{ default: ComponentType }>
  fallback: { loadingLabel: string; unavailableLabel: string }
}
