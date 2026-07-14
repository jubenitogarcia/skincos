import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUnifiedChannelId, unifiedChannelUrl, unifiedSystemUrl } from '../unifiedSystemUrl.js'

test('builds fixed Unified System routes for valid channels', () => {
    assert.equal(unifiedSystemUrl('/api/qr'), 'http://localhost:3001/api/qr')
    assert.equal(unifiedChannelUrl('1', 'status'), 'http://localhost:3001/whatsapp/1/status')
    assert.equal(unifiedChannelUrl(9, 'qrStream'), 'http://localhost:3001/whatsapp/9/qr/stream')
})

test('rejects channel input that could alter the upstream path', () => {
    for (const value of ['0', '10', '-1', '1?next=/api/qr', '1/../api/qr', '%2fapi%2fqr', '', null]) {
        assert.equal(parseUnifiedChannelId(value), null)
        assert.throws(() => unifiedChannelUrl(value, 'status'), /INVALID_UNIFIED_CHANNEL_ROUTE/)
    }
})
