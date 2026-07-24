const encoder = new TextEncoder();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function safeEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function readiness(env) {
  const database = await env.DB.prepare('SELECT 1 AS ok').first();
  const flag = await env.FLAGS.get('module_enabled');
  const sentinel = await env.DATA_BUCKET.head('_control/sentinel.json');
  return {
    ok: database?.ok === 1 && Boolean(sentinel) && flag === 'false',
    domain: env.DOMAIN,
    environment: env.ENVIRONMENT,
    version: env.APP_VERSION,
    dependencies: {
      d1: database?.ok === 1 ? 'healthy' : 'unavailable',
      kv: flag === 'false' ? 'healthy' : 'unexpected-value',
      r2: sentinel ? 'healthy' : 'sentinel-missing',
      queue: 'configured',
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, domain: env.DOMAIN, environment: env.ENVIRONMENT, version: env.APP_VERSION, module_enabled: false });
    if (request.method === 'GET' && url.pathname === '/readiness') {
      try { return json(await readiness(env)); }
      catch { return json({ ok: false, domain: env.DOMAIN, environment: env.ENVIRONMENT, error: 'DEPENDENCY_UNAVAILABLE' }, 503); }
    }
    if (request.method === 'POST' && url.pathname === '/control/queue-probe') {
      if (!safeEqual(request.headers.get('x-staging-probe-token'), env.STAGING_CONTROL_TOKEN)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
      const id = crypto.randomUUID();
      await env.EVENT_QUEUE.send({ kind: 'staging-probe', id, domain: env.DOMAIN, emittedAt: new Date().toISOString() });
      return json({ ok: true, id }, 202);
    }
    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (message.body?.kind !== 'staging-probe' || !message.body?.id) {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      await env.DB.prepare('INSERT OR REPLACE INTO staging_queue_receipts (id, received_at) VALUES (?, ?)').bind(String(message.body.id), new Date().toISOString()).run();
      message.ack();
    }
  },
};
