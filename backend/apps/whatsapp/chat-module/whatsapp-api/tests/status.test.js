const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createServer } = require('../src/server');

const { app } = createServer({ disableClient: true });

test('GET /status shape', async () => {
    const res = await request(app).get('/status');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Object.hasOwn(res.body, 'ready'));
    assert.ok(Object.hasOwn(res.body, 'uptimeMs'));
    assert.ok(Object.hasOwn(res.body, 'webhookQueueSize'));
    assert.strictEqual(res.body.testMode, true);
});
