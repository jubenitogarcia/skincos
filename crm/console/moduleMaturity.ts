export type OfficialModuleState = 'experimental' | 'staging' | 'pilot' | 'operational' | 'critical'

// Read-only administrative summary. The versioned technical catalog and CI are
// authoritative; this never grants a permission or activates a feature.
const technicalModuleStates: Record<string, OfficialModuleState> = {
  ads: 'experimental', api: 'experimental', booking: 'experimental', crm: 'experimental', finance: 'experimental', identity: 'experimental', integration: 'experimental', inventory: 'experimental', messaging: 'experimental',
  ops: 'experimental', orb: 'experimental', platform: 'experimental', service: 'experimental', shared: 'experimental', social: 'experimental', website: 'experimental', workforce: 'experimental',
}

export const technicalModuleMaturity: ReadonlyArray<{ id: string; state: OfficialModuleState }> = Object.entries(technicalModuleStates).map(([id, state]) => ({ id, state }))

export const officialStateLabel: Record<OfficialModuleState, string> = {
  experimental: 'Experimental', staging: 'Staging', pilot: 'Piloto', operational: 'Operacional', critical: 'Crítico',
}
