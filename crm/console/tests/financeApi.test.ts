import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { financeApi, minorUnitsFromDisplay } from '../financeApi'

describe('Finance transport helpers', () => {
  it('converts a decimal display value without floating point arithmetic', () => {
    expect(minorUnitsFromDisplay('120,50')).toBe(12050)
    expect(minorUnitsFromDisplay('0.01')).toBe(1)
  })

  it('rejects fractional minor units and non-positive values before transport', () => {
    expect(minorUnitsFromDisplay('12.345')).toBeNull()
    expect(minorUnitsFromDisplay('0')).toBeNull()
    expect(minorUnitsFromDisplay('-1')).toBeNull()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends movement search and filters to the Finance API rather than filtering client-side', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, page: 2, limit: 25, total: 31, movements: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.movements('finance-scope-novo-hamburgo', { q: 'ana', accountId: 'account-1', status: 'confirmed', page: 2, limit: 25 })
    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).toContain('/finance/movements?')
    expect(requested).toContain('scopeId=finance-scope-novo-hamburgo')
    expect(requested).toContain('q=ana')
    expect(requested).toContain('accountId=account-1')
    expect(requested).toContain('status=confirmed')
    expect(requested).toContain('page=2')
  })

  it('preserves idempotency conflicts for a visible recovery state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'IDEMPOTENCY_CONFLICT', message: 'payload diferente' }), { status: 409, headers: { 'content-type': 'application/json' } })))
    await expect(financeApi.create('/accounts', 'finance-scope-novo-hamburgo', { name: 'Banco', type: 'bank', currency: 'BRL' }, 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })

  it('sends a draft revision with the observed revision and an idempotency key', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, revision: 2 }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.reviseDraft('scope-nh', 'movement-1', { expectedRevision: 1, type: 'income', accountId: 'account-1', categoryId: 'category-1', description: 'Rascunho revisado', amountMinor: 1500, currency: 'BRL', competenceDate: '2026-07-22' }, 'draft-revision-key')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('/api/finance/movements/movement-1?scopeId=scope-nh')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('idempotency-key')).toBe('draft-revision-key')
    expect(JSON.parse(String(init.body))).toMatchObject({ expectedRevision: 1, description: 'Rascunho revisado' })
  })

  it('archives registrations through the API without a client-side delete', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, active: false }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.registrationLifecycle('scope-nh', 'accounts', 'account-1', 'archive', 'archive-key')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('/api/finance/accounts/account-1/archive?scopeId=scope-nh')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('idempotency-key')).toBe('archive-key')
  })

  it('keeps reconciliation lines, suggestions and confirmation in the Finance API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.reconciliationLines('scope-nh', 'account-1')
    await financeApi.createReconciliationLine('scope-nh', { accountId: 'account-1', postedDate: '2026-08-01', amountMinor: 1250, currency: 'BRL', externalId: 'statement-1' }, 'line-key')
    await financeApi.reconciliationSuggestions('scope-nh', 'line-1', 'suggest-key')
    await financeApi.reconciliationMatch('scope-nh', 'line-1', 'movement-1', 'confirm', 'match-key')
    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit }))
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining(['/api/finance/reconciliation/lines?scopeId=scope-nh&accountId=account-1', '/api/finance/reconciliation/lines?scopeId=scope-nh', '/api/finance/reconciliation/lines/line-1/suggestions?scopeId=scope-nh', '/api/finance/reconciliation/lines/line-1/matches?scopeId=scope-nh']))
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ movementId: 'movement-1', decision: 'confirm' })
  })

  it('keeps AP/AR titles and their ledger-backed settlements in the Finance API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.obligations('scope-nh', { kind: 'payable', status: 'open', from: '2026-08-01', to: '2026-08-31' })
    await financeApi.obligationSummary('scope-nh', { asOf: '2026-08-10', horizonDays: 30 })
    await financeApi.createObligation('scope-nh', { kind: 'payable', description: 'Fornecedor', amountMinor: 10000, currency: 'BRL', competenceDate: '2026-08-01', dueDate: '2026-08-10' }, 'obligation-create')
    await financeApi.settleObligation('scope-nh', 'obligation-1', { movementId: 'movement-1', principalAmountMinor: 10000, discountMinor: 500 }, 'obligation-settle')
    await financeApi.cancelObligation('scope-nh', 'obligation-2', 'Contrato cancelado', 'obligation-cancel')
    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit }))
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining(['/api/finance/obligations?scopeId=scope-nh&kind=payable&status=open&from=2026-08-01&to=2026-08-31', '/api/finance/obligations/summary?scopeId=scope-nh&asOf=2026-08-10&horizonDays=30', '/api/finance/obligations?scopeId=scope-nh', '/api/finance/obligations/obligation-1/settlements?scopeId=scope-nh', '/api/finance/obligations/obligation-2/cancel?scopeId=scope-nh']))
    const settlementCall = calls.find((call) => call.url.includes('/obligations/obligation-1/settlements?'))
    expect(new Headers(settlementCall?.init.headers).get('idempotency-key')).toBe('obligation-settle')
    expect(JSON.parse(String(settlementCall?.init.body))).toMatchObject({ movementId: 'movement-1', principalAmountMinor: 10000 })
  })

  it('uses the recurrence planning API without a browser-side ledger write', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, recurrences: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.recurrences('scope-nh', { limit: 25 })
    await financeApi.createRecurrence('scope-nh', { kind: 'payable', frequency: 'monthly', description: 'Aluguel', amountMinor: 50000, currency: 'BRL', competenceDay: 5, dueDay: 10, startsOn: '2026-08-01' }, 'recurrence-create')
    await financeApi.materializeRecurrence('scope-nh', 'recurrence-1', '2026-10-10', 'recurrence-materialize')
    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit }))
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining(['/api/finance/recurrences?scopeId=scope-nh&limit=25', '/api/finance/recurrences?scopeId=scope-nh', '/api/finance/recurrences/recurrence-1/materialize?scopeId=scope-nh']))
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ throughDate: '2026-10-10' })
    expect(new Headers(calls[2].init.headers).get('idempotency-key')).toBe('recurrence-materialize')
  })

  it('sends staged CSV decisions, idempotent commit and audited undo to server routes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.stageCsv('scope-nh', 'extrato.csv', 'Data;Valor\n01/07/2026;1,00\n', { encoding: 'utf-8', idempotencyKey: 'stage-key' })
    await financeApi.importAnalyze('scope-nh', 'batch-1', { mapping: { date: 'Data', amount: 'Valor' } }, 'analyze-key')
    await financeApi.importDecision('scope-nh', 'batch-1', { rowId: 'row-1', decision: 'skip', reason: 'Duplicidade provável' }, 'decision-key')
    await financeApi.importCommit('scope-nh', 'batch-1', { defaultAccountId: 'account-1', incomeCategoryId: 'income-1', expenseCategoryId: 'expense-1' }, 'commit-key')
    await financeApi.importUndo('scope-nh', 'batch-1', 'Arquivo incorreto', 'undo-key')
    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit }))
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining(['/api/finance/imports?scopeId=scope-nh', '/api/finance/imports/batch-1/analyze?scopeId=scope-nh', '/api/finance/imports/batch-1/decisions?scopeId=scope-nh', '/api/finance/imports/batch-1/commit?scopeId=scope-nh', '/api/finance/imports/batch-1/undo?scopeId=scope-nh']))
    expect(new Headers(calls[3].init.headers).get('idempotency-key')).toBe('commit-key')
  })

  it('declares MoneyWiz as an import source instead of a ledger write path', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.stageCsv('scope-nh', 'moneywiz.csv', 'Date,Description,Amount\n2026-07-01,Teste,1.00\n', { sourceType: 'moneywiz', idempotencyKey: 'moneywiz-stage' })
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ sourceType: 'moneywiz' })
  })

  it('sends the controlled Caixa EF delivery as an import source, not a client-side ledger mutation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const efCaixa = { contractVersion: 'ef-caixa/v1', source: { executionId: 'run-1' }, unit: { slug: 'novo-hamburgo' }, period: { from: '2026-07-01', to: '2026-07-01' }, records: [] }
    await financeApi.stageCsv('scope-nh', 'caixa-ef.json', JSON.stringify(efCaixa), { sourceType: 'ef-caixa', efCaixa, idempotencyKey: 'ef-caixa-stage' })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toMatchObject({ sourceType: 'ef-caixa', efCaixa })
    expect(body.csv).toBeUndefined()
  })

  it('routes Finance browser requests through the Pages proxy instead of the static shell', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'))
    expect(routes.include).toContain('/api/finance/*')
  })

  it('keeps the local authorization smoke synchronized with the asynchronous Finance bootstrap gate', () => {
    const smoke = readFileSync(new URL('../scripts/finance-local-smoke.cjs', import.meta.url), 'utf8')
    expect(smoke).toContain("financeNav.waitFor({ state: 'hidden', timeout: 30_000 })")
    expect(smoke).toContain('bootstrap.body.moduleEnabled !== false || bootstrap.body.canAccess !== false')
    expect(smoke).toContain("scenario === 'no-module' && /server responded with a status of 403/i.test(message)")
  })
})
