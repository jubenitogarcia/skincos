import { migrateAtendimento } from '../server/atendimento/store.js'

export async function apply(client) {
    await migrateAtendimento(client)
}
