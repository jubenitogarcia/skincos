const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createServer } = require('../src/server');

const { app } = createServer({ disableClient: true });

test('GET /messages returns empty list structure', async () => {
    const res = await request(app).get('/messages');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(Object.hasOwn(res.body, 'nextCursor'));
    assert.ok(Object.hasOwn(res.body, 'total'));
});
