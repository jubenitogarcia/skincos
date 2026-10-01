import type { PontoProfile } from './pontoTypes'

const fieldLabels: Record<string, string> = {
  legalName: 'nome',
  employeeCode: 'matrícula',
  jobTitle: 'cargo',
  admittedAt: 'data de admissão',
  groupName: 'grupo',
  departmentName: 'departamento',
  mobilePhone: 'celular',
  birthDate: 'data de nascimento',
  birthPlace: 'naturalidade',
  educationLevel: 'grau de instrução',
  zipCode: 'CEP',
  city: 'cidade',
  state: 'estado',
}

export function profileFieldLabel(field: string): string {
  return fieldLabels[field] || field
}

export function profileMissingSummary(profile: Pick<PontoProfile, 'documents'>, missing: string[]): string {
  const missingLabels = missing.map(profileFieldLabel)
  const pendingDocuments = Object.values(profile.documents).filter((status) => status === 'PENDENTE').length
  const parts: string[] = []
  if (missingLabels.length) parts.push(missingLabels.join(', '))
  if (pendingDocuments) parts.push(`${pendingDocuments} documento(s) pendente(s)`)
  return parts.length ? `Cadastros pendentes: ${parts.join(' • ')}.` : 'Perfil cadastrado e pronto para uso.'
}

export function profileValue(value?: string | null, fallback = 'Não informado'): string {
  return String(value || '').trim() || fallback
}
