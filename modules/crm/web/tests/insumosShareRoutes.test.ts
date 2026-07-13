import { describe, expect, it, vi } from 'vitest'

// The Insumos Worker is JavaScript and intentionally shared with the CRM test suite.
// @ts-ignore
import { handleShareRoutes } from '../../../../backend/apps/insumos/src/routes/share.js'

type QueryCall = { sql: string; bindings: unknown[] }

function createDb() {
  const calls: QueryCall[] = []
  const row = {
    id: 'share-1',
    createdAt: '2026-07-10T12:00:00.000Z',
    title: 'Arquivo',
    text: 'Conteúdo',
    url: 'https://example.test/file',
    filesJson: '[]',
    sourceId: 'source-1',
  }

  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings })
          return {
            first: async () => {
              if (sql.includes('COUNT(1)')) return { total: 1 }
              if (sql.includes('WHERE id = ?')) return row
              return null
            },
            all: async () => ({ results: [row] }),
            run: async () => ({ success: true }),
          }
        },
      }
    },
  }
}

function createContext(path: string, init: RequestInit = {}) {
  const db = createDb()
  return {
    db,
    args: {
      request: new Request(`http://127.0.0.1:8787${path}`, init),
      url: new URL(`http://127.0.0.1:8787${path}`),
      env: { DB: db },
      appOrigin: 'http://localhost:8791',
      withCORS: (body: BodyInit | null, responseInit: ResponseInit = {}) => new Response(body, responseInit),
      requireRoles: vi.fn().mockResolvedValue({ ok: true, user: { username: 'dev', role: 'GESTOR' } }),
    },
  }
}

describe('Insumos share history routes', () => {
  it('lists history instead of treating history as a share id', async () => {
    const { args, db } = createContext('/share/history?limit=12')

    const response = await handleShareRoutes(args)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, data: [{ id: 'share-1' }], resumo: { total: 1, pagina: 1, limit: 12 } })
    expect(db.calls.some((call) => call.sql.includes('COUNT(1)'))).toBe(true)
    expect(db.calls.some((call) => call.sql.includes('WHERE id = ?'))).toBe(false)
  })

  it('creates and removes history records through their dedicated routes', async () => {
    const create = createContext('/share/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'share-2', title: 'Novo arquivo', files: [] }),
    })
    const createResponse = await handleShareRoutes(create.args)
    expect(createResponse.status).toBe(200)
    expect(create.db.calls.some((call) => call.sql.includes('INSERT OR REPLACE INTO share_history'))).toBe(true)

    const remove = createContext('/share/history/share-2', { method: 'DELETE' })
    const removeResponse = await handleShareRoutes(remove.args)
    expect(removeResponse.status).toBe(200)
    expect(remove.db.calls.some((call) => call.sql.includes('DELETE FROM share_history'))).toBe(true)
  })

  it('keeps individual share lookup separate from history', async () => {
    const { args, db } = createContext('/share/share-1')

    const response = await handleShareRoutes(args)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ id: 'share-1', title: 'Arquivo' })
    expect(db.calls.some((call) => call.sql.includes('WHERE id = ?'))).toBe(true)
  })

  it('returns the authentication response before touching D1', async () => {
    const { args, db } = createContext('/share/history')
    args.requireRoles.mockResolvedValue({ ok: false, response: new Response('{"error":"UNAUTHORIZED"}', { status: 401 }) })

    const response = await handleShareRoutes(args)

    expect(response.status).toBe(401)
    expect(db.calls).toHaveLength(0)
  })
})
