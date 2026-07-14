const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeWhatsappContactId } = require('../inputValidation');

test('normalizes a scalar WhatsApp contact identifier', () => {
    assert.equal(normalizeWhatsappContactId('5511999999999'), '5511999999999@c.us');
    assert.equal(normalizeWhatsappContactId('5511999999999@c.us'), '5511999999999@c.us');
});

test('rejects query arrays and non-contact input', () => {
    assert.equal(normalizeWhatsappContactId(['5511999999999', '5511888888888']), null);
    assert.equal(normalizeWhatsappContactId({ toString: () => '5511999999999' }), null);
    assert.equal(normalizeWhatsappContactId('@c.us'), null);
});
