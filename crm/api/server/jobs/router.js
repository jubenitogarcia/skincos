import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import express from 'express'

export function createJobsRouter({ jobsDir, backendRoot }) {
    mkdirSync(jobsDir, { recursive: true })
    const jobs = new Map()
    const normalize = (value) => String(value || '').trim().toLowerCase()
    const allowed = (value, values, label) => {
        if (!values.includes(value)) throw new Error(`${label} inválido: ${value}. Permitidos: ${values.join(', ')}`)
        return value
    }
    const commandFor = (job, params = {}) => {
        const name = normalize(job)
        if (name !== 'sales-chart-messenger') throw new Error(`Job desconhecido: ${job}`)
        const mode = allowed(String(params.mode || 'diagnose'), ['run', 'test', 'diagnose'], 'mode')
        const period = allowed(String(params.period || 'morning'), ['morning', 'evening'], 'period')
        const cellSet = params.cell_set ? allowed(String(params.cell_set), ['bss', 'nh'], 'cell_set') : null
        if ((mode === 'run' || mode === 'test') && !cellSet) throw new Error('cell_set é obrigatório para mode run/test (bss|nh)')
        const args = ['-m', 'apps.automations.sales_chart_messenger', '--mode', mode, '--period', period]
        if (params.force) args.push('--force')
        if (cellSet) args.push(cellSet)
        return { name, cmd: 'python3', args }
    }
    const start = (job, params) => {
        const { name, cmd, args } = commandFor(job, params)
        const startedAt = new Date().toISOString()
        const meta = { id: randomUUID(), job: name, params, status: 'running', startedAt, endedAt: null, exitCode: null }
        meta.logPath = path.join(jobsDir, `${meta.id}.log`)
        jobs.set(meta.id, meta)
        const child = spawn(cmd, args, { cwd: backendRoot, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
        const out = createWriteStream(meta.logPath, { flags: 'a' })
        out.write(`=== JOB START ${startedAt} ===\njob=${meta.job}\ncmd=${cmd} ${args.join(' ')}\n\n`)
        child.stdout?.pipe(out); child.stderr?.pipe(out)
        child.on('close', (code) => { meta.status = 'done'; meta.endedAt = new Date().toISOString(); meta.exitCode = code; out.end() })
        child.on('error', (error) => { meta.status = 'error'; meta.endedAt = new Date().toISOString(); meta.exitCode = null; out.write(`\n=== JOB ERROR ===\n${error?.message || error}\n`); out.end() })
        return meta
    }
    const router = express.Router()
    router.post('/run', (req, res) => { try { res.json({ ok: true, job: start(req.body?.job, req.body?.params || {}) }) } catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }) } })
    router.get('/', (req, res) => {
        const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query?.limit || '50'), 10) || 50))
        res.json({ ok: true, jobs: [...jobs.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit) })
    })
    router.get('/:id', (req, res) => { const job = jobs.get(String(req.params.id || '')); return job ? res.json({ ok: true, job }) : res.status(404).json({ ok: false, error: 'Job not found' }) })
    router.get('/:id/log', (req, res) => {
        const job = jobs.get(String(req.params.id || '')); if (!job) return res.status(404).json({ ok: false, error: 'Job not found' })
        const lines = Math.max(10, Math.min(2_000, Number.parseInt(String(req.query?.lines || '200'), 10) || 200))
        let tail = ''; try { const rows = readFileSync(job.logPath, 'utf8').split('\n'); tail = rows.slice(-lines).join('\n') } catch { /* job may not have written yet */ }
        return res.json({ ok: true, id: job.id, lines, logPath: job.logPath, tail })
    })
    return router
}
