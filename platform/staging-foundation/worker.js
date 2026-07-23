const encoder = new TextEncoder();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

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
    ok: database?.ok === 1 && Boolean(sentinel),
    domain: env.DOMAIN,
    environment: env.ENVIRONMENT,
    version: env.APP_VERSION,
    featureFlags: { module_enabled: flag === 'true' },
    dependencies: {
      d1: database?.ok === 1 ? 'healthy' : 'unavailable',
      kv: flag === 'false' ? 'healthy' : 'unexpected-value',
      r2: sentinel ? 'healthy' : 'sentinel-missing',
      queue: 'configured',
    },
    secrets: { stagingControlToken: Boolean(env.STAGING_CONTROL_TOKEN) },
  };
}

const migrationProbe = {
  identity: { table: 'identity_users', compatibility: 'legacy-shared-read-primary' },
  inventory: { table: 'insumos_categories', compatibility: 'legacy-shared-read-primary' },
  finance: { table: 'finance_settings', compatibility: 'legacy-shared-read-primary' },
};

async function migrationStatus(env) {
  const probe = migrationProbe[env.DOMAIN];
  if (!probe) throw new Error('UNKNOWN_DOMAIN');
  const [latest, target] = await Promise.all([
    env.DB.prepare("SELECT id,status,finished_at FROM domain_migration_runs WHERE domain=? ORDER BY started_at DESC LIMIT 1").bind(env.DOMAIN).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM ${probe.table}`).first(),
  ]);
  return {
    ok: latest?.status === 'verified',
    domain: env.DOMAIN,
    legacyCompatibility: probe.compatibility,
    latestRun: latest ? { id: latest.id, status: latest.status, finishedAt: latest.finished_at } : null,
    targetCount: Number(target?.count || 0),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, domain: env.DOMAIN, environment: env.ENVIRONMENT, version: env.APP_VERSION, featureFlags: { module_enabled: false } });
    }
    if (request.method === 'GET' && url.pathname === '/readiness') {
      try {
        return json(await readiness(env));
      } catch {
        return json({ ok: false, domain: env.DOMAIN, environment: env.ENVIRONMENT, error: 'DEPENDENCY_UNAVAILABLE' }, 503);
      }
    }
    if (request.method === 'GET' && url.pathname === '/migration-status') {
      try {
        const status = await migrationStatus(env);
        return json(status, status.ok ? 200 : 503);
      } catch {
        return json({ ok: false, domain: env.DOMAIN, error: 'MIGRATION_STATUS_UNAVAILABLE' }, 503);
      }
    }
    if (request.method === 'GET' && url.pathname === '/fixtures') {
      const fixtures = await env.DB.prepare('SELECT id, label, contains_personal_data FROM staging_fixtures ORDER BY id').all();
      return json({ ok: true, fixtures: fixtures.results || [] });
    }
    if (request.method === 'POST' && url.pathname === '/control/queue-probe') {
      if (!safeEqual(request.headers.get('x-staging-probe-token'), env.STAGING_CONTROL_TOKEN)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
      const id = crypto.randomUUID();
      await env.EVENT_QUEUE.send({ kind: 'staging-probe', id, domain: env.DOMAIN, emittedAt: new Date().toISOString() });
      return json({ ok: true, id }, 202);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/control/queue-probe/')) {
      const id = url.pathname.split('/').at(-1);
      const receipt = await env.DB.prepare('SELECT id, received_at FROM staging_queue_receipts WHERE id = ?').bind(id).first();
      return receipt ? json({ ok: true, receipt }) : json({ ok: false, error: 'NOT_READY' }, 404);
    }
    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const body = message.body || {};
      if (body.kind !== 'staging-probe' || !body.id) {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      await env.DB.prepare(
        'INSERT OR REPLACE INTO staging_queue_receipts (id, received_at) VALUES (?, ?)',
      ).bind(String(body.id), new Date().toISOString()).run();
      message.ack();
    }
  },
};
