import assert from 'node:assert/strict'
import test from 'node:test'
import { configuredCorsOrigins, isAllowedCrmCorsOrigin } from '../corsPolicy.js'

test('allows only explicit production CRM origins', () => {
    const allowed = configuredCorsOrigins('https://crm.skincos.com.br,https://espacofacial.com')
    assert.equal(isAllowedCrmCorsOrigin('https://crm.skincos.com.br', { allowedOrigins: allowed, environment: 'production' }), true)
    assert.equal(isAllowedCrmCorsOrigin('https://attacker.invalid', { allowedOrigins: allowed, environment: 'production' }), false)
    assert.equal(isAllowedCrmCorsOrigin('https://crm.skincos.com.br.evil.invalid', { allowedOrigins: allowed, environment: 'production' }), false)
})

test('permits loopback development origins but never production wildcard behavior', () => {
    const allowed = configuredCorsOrigins('https://crm.skincos.com.br')
    assert.equal(isAllowedCrmCorsOrigin('http://localhost:5173', { allowedOrigins: allowed, environment: 'development' }), true)
    assert.equal(isAllowedCrmCorsOrigin('http://localhost:5173', { allowedOrigins: allowed, environment: 'production' }), false)
    assert.equal(isAllowedCrmCorsOrigin('null', { allowedOrigins: allowed, environment: 'development' }), false)
})
