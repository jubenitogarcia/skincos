/**
 * Runs one database transaction and always releases the acquired client.
 * The driver-specific pool stays in the owning domain; this neutral wrapper
 * lets resilience tests inject a failing client without loading that driver.
 */
export async function withRollbackTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (error) {
    try { await client.query('rollback'); } catch { /* best-effort rollback */ }
    throw error;
  } finally {
    client.release();
  }
}
