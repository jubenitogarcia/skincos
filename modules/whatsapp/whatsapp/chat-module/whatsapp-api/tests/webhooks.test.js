const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createServer } = require('../src/server');

const { app } = createServer({ disableClient: true });

test('webhooks CRUD lifecycle', async () => {
    // list empty
    let res = await request(app).get('/webhooks');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    // create
    res = await request(app).post('/webhooks').send({ url: 'https://example.com/hook', events: ['message'] });
    assert.strictEqual(res.statusCode, 201);
    const created = res.body;
    assert.ok(created.id);
    // list again
    res = await request(app).get('/webhooks');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.length, 1);
    // update
    res = await request(app).put(`/webhooks/${created.id}`).send({ url: 'https://example.com/hook2', events: [] });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.url, 'https://example.com/hook2');
    // delete
    res = await request(app).delete(`/webhooks/${created.id}`);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { removed: true });
});
