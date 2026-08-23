export type UnifiedTeamConfig = {
  enabled: boolean
  legacyEscalaEditor: boolean
}

export type UnifiedTeamMember = {
  id: string
  fullName: string
  username?: string | null
  corporateEmail: string
  workforceEmployeeId?: string | null
  profile: string
  jobTitle: string
  department: string
  units: string[]
  accountStatus: string
  schedule?: {
    professionalId?: string | null
    status?: string
    role?: string
    shift?: string
    nickname?: string
    instagram?: string
    color?: string
    units?: string[]
  }
  identityLinks?: Array<{
    source: string
    sourceId: string
    reviewStatus: string
  }>
  createdAt?: string
  updatedAt?: string
}

export function buildCorporateEmail(fullName: string) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  const normalize = (value: string) => value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
  const first = normalize(parts[0])
  const last = parts.length > 1 ? normalize(parts[parts.length - 1]) : ''
  return first && (parts.length === 1 || last) ? `${first}${last}@espacofacial.com` : ''
}

export function suggestUsername(fullName: string, corporateEmail = '') {
  const local = String(corporateEmail || '').split('@')[0]
  const normalize = (value: string) => value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40)
  const fromEmail = normalize(local)
  if (fromEmail.length >= 3) return fromEmail
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  return normalize(`${parts[0] || ''}${parts.length > 1 ? parts[parts.length - 1] : ''}`)
}
