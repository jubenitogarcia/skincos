import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

import express from 'express';

import { registerRuntimeHealthRoute } from '../src/api/routes/runtimeHealth.route';

async function run() {
  const app = express();
  registerRuntimeHealthRoute(app);

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'messaging-whatsapp' });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

run().then(
  () => console.log('Messaging WhatsApp runtime health regression checks passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
