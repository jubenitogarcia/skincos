import { getPontoUser, type PontoAuthUser } from './pontoAuth'

export type InsumosAuthUser = PontoAuthUser

export async function getInsumosUser(context: any): Promise<InsumosAuthUser | null> {
  return getPontoUser(context)
}
