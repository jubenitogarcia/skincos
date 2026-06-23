import test from 'node:test'
import assert from 'node:assert/strict'

import { gvizTableRowsToValues } from '../importer.js'

test('infers year rollover from public gviz day-month formatted dates', () => {
    const rows = gvizTableRowsToValues([
        { c: [{ v: 'Date(2026,0,16)', f: '16/01' }, { v: 'Cliente A' }] },
        { c: [{ v: 'Date(2026,11,18)', f: '18/12' }, { v: 'Cliente B' }] },
        { c: [{ v: 'Date(1969,11,6)', f: '06/12' }, { v: 'Cliente C' }] },
    ])
    assert.equal(rows[0][0], 'Date(2026,0,16)')
    assert.equal(rows[1][0], 'Date(2025,11,18)')
    assert.equal(rows[2][0], 'Date(2025,11,6)')
})

test('preserves gviz column labels as header row when Google promotes the first row', () => {
    const rows = gvizTableRowsToValues(
        [{ c: [{ v: 'Botox' }, { v: '#0799' }, null, { v: 'Dra. Sintética' }] }],
        [{ label: 'PROCEDIMENTOS' }, { label: 'CODIGOS' }, { label: '' }, { label: 'NOME' }],
    )
    assert.deepEqual(rows[0], ['PROCEDIMENTOS', 'CODIGOS', '', 'NOME'])
    assert.deepEqual(rows[1].slice(0, 4), ['Botox', '#0799', '', 'Dra. Sintética'])
})
