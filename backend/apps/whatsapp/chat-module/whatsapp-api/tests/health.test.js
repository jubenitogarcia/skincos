const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createServer } = require('../src/server');

const { app } = createServer({ disableClient: true });

test('GET /health returns ok true', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { ok: true });
});
