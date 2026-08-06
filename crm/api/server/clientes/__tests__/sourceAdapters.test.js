import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientesSourceAdapters } from '../sourceAdapters.js'

const pool = {
    async query(sql) {
        if (sql.includes('app_client_registrations')) return { rows: [{ records: 2, last_updated: '2026-08-06T10:00:00Z' }] }
        if (sql.includes('harmonia.contacts')) return { rows: [{ records: 2, opted_out: 1, last_updated: '2026-08-06T10:00:00Z' }] }
        if (sql.includes('commercial_contact_permissions')) return { rows: [{ records: 2, blocked: 1, last_updated: '2026-08-06T10:00:00Z' }] }
        return { rows: [{ identities: 1, members: 2, last_updated: '2026-08-06T10:00:00Z' }] }
    },
}

test('source adapters expose complete synthetic snapshots and no PII metrics', async () => {
    const adapters = createClientesSourceAdapters({
        pool,
        databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
        config: {
            atendimento: { spreadsheetId: 'synthetic-atendimento', serviceAccountFile: 'synthetic' },
            gerencia: { spreadsheetId: 'synthetic-gerencia', serviceAccountFile: 'synthetic' },
            caixa: { spreadsheetId: 'synthetic-caixa', serviceAccountFile: 'synthetic' },
            leads: { spreadsheetId: 'synthetic-leads', serviceAccountFile: 'synthetic' },
        },
        readers: {
            async readAtendimento() { return { spreadsheetId: 'synthetic-atendimento', tabs: ['Novo Hamburgo', 'BarraShoppingSul'], records: [{ date: '2026-08-06', id: 1 }], cache: {} } },
            async readGerencia() { return { spreadsheetId: 'synthetic-gerencia', tabs: [{ tabName: 'Equipe' }, { tabName: 'Horário' }, { tabName: 'Procedimento' }], rawRows: [{ row: 1 }], managementItems: [], inventory: [] } },
            async readCaixa() { return { spreadsheetId: 'synthetic-caixa', tabs: ['BarraShoppingSul', 'Novo Hamburgo'], records: [{ date: '2026-08-06' }] } },
            async readLeads() { return { spreadsheetId: 'synthetic-leads', tabNames: ['Lead'], tabs: { Lead: [['Nome'], ['Pessoa sintética']] }, profiles: [{ id: 'lead-1', name: 'Pessoa sintética', nameKey: 'pessoa sintetica', phones: [], emails: [], sourceRows: [] }] } },
        },
    })
    const sources = await Promise.all([
        adapters['atendimento.google_sheet'].read(),
        adapters['cadastro.gerencia_google_sheet'].read(),
        adapters['vendas.caixa_google_sheet'].read(),
        adapters['leads.supplemental_google_sheet'].read(),
        adapters['consent.harmonia_opt_outs'].read(),
    ])
    assert.ok(sources.every((source) => source.snapshotComplete === true))
    assert.ok(sources.every((source) => /^sha256:[0-9a-f]{64}$/.test(source.fingerprint)))
    assert.equal(Object.values(sources[4].coverage).some((value) => typeof value === 'string' && /@/.test(value)), false)
})
