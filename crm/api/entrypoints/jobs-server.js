import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJobsRouter } from '../server/jobs/router.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const port = Number(process.env.CRM_JOBS_PORT || 8101)
const jobsDir = String(process.env.CRM_JOBS_DIR || path.join(process.env.CRM_VAR_DIR || path.join(root, 'var'), 'jobs'))
const app = express(); app.use(express.json({ limit: '256kb' }))
app.get('/health', (_req, res) => res.json({ ok: true, service: 'crm-jobs' }))
app.use('/', createJobsRouter({ jobsDir, backendRoot: path.join(root, 'backend') }))
app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ level: 'info', module: 'crm-jobs', event: 'listening', port })))
