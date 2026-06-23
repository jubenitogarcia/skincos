import test from 'node:test'
import assert from 'node:assert/strict'

import { canAccessAtendimento } from '../store.js'

test('scopes atendimento-clinica router access by consuming module', () => {
    const procedimentosActor = { role: 'INJETOR', allowedModules: ['procedimentos'] }
    assert.equal(canAccessAtendimento(procedimentosActor, '/management/catalog', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/references', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'POST'), false)

    const faturamentoActor = { role: 'INJETOR', allowedModules: ['faturamento'] }
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/commercial', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/finance', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/catalog', 'GET'), false)
})
