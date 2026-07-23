import { startHarmoniaWorker } from '../server/harmonia/worker.js'

const varDir = String(process.env.CRM_VAR_DIR || '').trim()
if (!varDir) throw new Error('CRM_VAR_DIR is required for the Harmonia worker')
const worker = startHarmoniaWorker({ varDir })
console.log(JSON.stringify({ level: 'info', module: 'harmonia-worker', event: 'started' }))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { worker.stop?.(); process.exit(0) })
