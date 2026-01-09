export type CapabilityKind = 'core' | 'service' | 'automation' | 'utility' | 'agent'

export interface CapabilitiesCatalog {
  version: number
  core?: Record<
    string,
    {
      id: string
      path: string
      kind: CapabilityKind
      ports?: Record<string, number | string>
    }
  >
  capabilities?: Array<{
    id: string
    label?: string
    path: string
    kind: CapabilityKind
    ports?: Record<string, number | string>
    health?: { path?: string; alt?: string }
    notes?: string
  }>
}

export async function fetchCapabilitiesCatalog(): Promise<CapabilitiesCatalog> {
  const res = await fetch('/api/core/capabilities', { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to load capabilities (${res.status}): ${text || res.statusText}`)
  }
  const json = await res.json()
  if (!json || json.ok !== true || !json.data) {
    throw new Error('Capabilities payload invalid')
  }
  return json.data as CapabilitiesCatalog
}

