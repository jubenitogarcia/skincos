// Compat shim: historically this file was named "insumosAuth" because auth lived under /insumos/auth/*,
// but these helpers represent CRM session auth for Pages Functions.
import type { CrmAuthUser } from './crmAuth'
import { getCrmUser, requireCrmUser } from './crmAuth'

export type InsumosAuthUser = CrmAuthUser

export async function getInsumosUser(context: any): Promise<InsumosAuthUser | null> {
  return getCrmUser(context)
}

export async function requireInsumosUser(context: any): Promise<InsumosAuthUser | Response> {
  return requireCrmUser(context)
}
