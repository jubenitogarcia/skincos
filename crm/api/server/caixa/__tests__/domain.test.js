import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCaixaRecords, inferProcedureName, normalizePhone, normalizeText } from '../domain.js'

test('normaliza identidade e procedimentos confiáveis', () => {
    assert.equal(normalizeText(' Júlia  Ávila '), 'julia avila')
    assert.equal(normalizePhone('(51) 99999-0000'), '5551999990000')
    assert.equal(inferProcedureName('Labial (1ml)'), 'Preenchimento')
    assert.equal(inferProcedureName('Indefinido'), null)
})

test('preserva total da venda e itens repetidos', () => {
    const records = buildCaixaRecords({ BarraShoppingSul: [['DATA'], ['05/03/2025', '11:13', 'Ana', '51999990000', 'R$ 1.197,00', 'Botox 3 Regiões (até 40 ui)\nBotox 3 Regiões (até 40 ui)']], 'Novo Hamburgo': [['DATA']] })
    assert.equal(records.length, 1)
    assert.equal(records[0].total, 1197)
    assert.equal(records[0].items.length, 1)
    assert.equal(records[0].items[0].quantity, 2)
    assert.equal(records[0].items[0].inferredProcedureName, 'Botox')
})
