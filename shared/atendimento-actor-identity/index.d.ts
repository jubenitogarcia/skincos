export type ProfessionalActorIdentity = {
    professionalId?: string
    workforceEmployeeId?: string
    professionalIdentityStatus?: 'CONFIRMED' | 'UNLINKED' | 'UNAVAILABLE'
}
export function normalizeProfessionalActorIdentity(actor: unknown): ProfessionalActorIdentity | null
