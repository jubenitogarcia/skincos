class SqliteLedger {
  constructor(db) { this.db = db; }
  static open(file) { let Database; try { Database = require('better-sqlite3'); } catch (error) { throw new Error(`better-sqlite3 is required for SqliteLedger: ${error.message}`); } return new SqliteLedger(new Database(file)); }
  migrate(sql) { this.db.exec(sql); }
  upsertJob(job) { const key = `${job.production_id}:${job.module}:${job.component_id}:${job.revision}`; const statement = this.db.prepare('insert into production_jobs (job_key, production_id, module, component_id, revision, status, input_hash, output_hash, provider, provider_request_id, cost, attempt) values (@job_key,@production_id,@module,@component_id,@revision,@status,@input_hash,@output_hash,@provider,@provider_request_id,@cost,@attempt) on conflict(job_key) do update set status=excluded.status, output_hash=excluded.output_hash, updated_at=current_timestamp'); return statement.run({ job_key: key, output_hash: null, provider: null, provider_request_id: null, cost: 0, attempt: 0, ...job, job_key: key }); }
  close() { this.db.close(); }
}
module.exports = { SqliteLedger };
