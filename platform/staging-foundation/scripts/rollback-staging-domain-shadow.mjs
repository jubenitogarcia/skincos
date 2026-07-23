#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const domain = String(process.argv[2] || '');
const databases = { identity: 'skincos-identity-staging', inventory: 'skincos-inventory-staging', finance: 'skincos-finance-staging' };
if (!databases[domain]) throw new Error('Usage: rollback-staging-domain-shadow.mjs <identity|inventory|finance>');
if (process.env.SKINCOS_STAGING_ROLLBACK_ACK !== '1') throw new Error('SKINCOS_STAGING_ROLLBACK_ACK=1 is required');
const statement = `UPDATE domain_migration_runs SET status='rolled_back',finished_at=CURRENT_TIMESTAMP,notes=notes || '; rollback: legacy shared staging remains primary and isolated shadow retained for audit' WHERE id=(SELECT id FROM domain_migration_runs WHERE domain='${domain}' AND status='verified' ORDER BY finished_at DESC LIMIT 1);`;
execFileSync('npx', ['wrangler', 'd1', 'execute', databases[domain], '--remote', '--command', statement, '--json'], { stdio: 'inherit' });
console.log(`rolled back ${domain} routing state without deleting isolated staging data`);
