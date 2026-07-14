import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveEvolutionMediaUrl } from '../whatsappMediaUrl.js'

test('builds a fixed WhatsApp media URL from a direct path', () => {
    assert.equal(
        resolveEvolutionMediaUrl(undefined, '/v/t62.7118-24/123?token=abc'),
        'https://mmg.whatsapp.net/v/t62.7118-24/123?token=abc'
    )
})

test('rejects arbitrary, prefix-confusion and protocol-relative media URLs', () => {
    for (const value of [
        'https://web.whatsapp.net.evil.invalid/file',
        'https://attacker.invalid/file',
        'http://mmg.whatsapp.net/file',
        'javascript:alert(1)'
    ]) {
        assert.equal(resolveEvolutionMediaUrl(value, undefined), undefined)
    }

    assert.equal(resolveEvolutionMediaUrl(undefined, '//attacker.invalid/file'), undefined)
})
