#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPgPool, withPgTransaction } from '../server/postgres/pool.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'migrations')
const role = String(process.env.PG_MIGRATION_SET_ROLE || '').trim()
if (role && role !== 'skincos_staging_crm_owner') throw new Error('PG_MIGRATION_SET_ROLE is not an approved staging owner role')
const pool = createPgPool(process.env.DATABASE_URL, { domain: 'migration' })
if (!pool) throw new Error('DATABASE_URL is required')

const files = (await fs.readdir(migrationsDir)).filter((file) => /^\d{4}_.+\.(sql|mjs)$/.test(file)).sort()
await withPgTransaction(pool, async (client) => {
    if (role) await client.query(`set role ${role}`)
    await client.query('create table if not exists skincos_migrations.applied (id text primary key, checksum text not null, applied_at timestamptz not null default now())')
    const applied = new Map((await client.query('select id,checksum from skincos_migrations.applied')).rows.map((row) => [row.id, row.checksum]))
    for (const file of files) {
        const contents = await fs.readFile(path.join(migrationsDir, file), 'utf8')
        const checksum = createHash('sha256').update(contents).digest('hex')
        if (applied.has(file)) {
            if (applied.get(file) !== checksum) throw new Error(`migration checksum drift: ${file}`)
            continue
        }
        if (file.endsWith('.sql')) await client.query(contents)
        else await (await import(pathToFileURL(path.join(migrationsDir, file)).href)).apply(client)
        await client.query('insert into skincos_migrations.applied(id,checksum) values($1,$2)', [file, checksum])
        console.log(`applied ${file}`)
    }
})
await pool.end()
