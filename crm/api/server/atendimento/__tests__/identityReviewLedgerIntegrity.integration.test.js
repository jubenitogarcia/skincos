import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

import { isStrictLocalMirrorDestination } from '../mirror.js'

// This is deliberately opt-in: the normal unit suite stays hermetic.  The URL
// is fixed rather than configurable so the proof can never open a network
// database connection.
const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
const RUN_LOCAL_POSTGRES_INTEGRATION = process.env.SKINCOS_RUN_LOCAL_POSTGRES_INTEGRATION === '1'

const LEDGER_NO_TRUNCATE_TRIGGER_NAMES = [
    ['identity_lineage', 'identity_lineage_no_truncate'],
    ['identity_member_history', 'identity_member_history_no_truncate'],
    ['identity_review_decisions', 'identity_review_decisions_no_truncate'],
    ['identity_source_link_history', 'identity_source_link_history_no_truncate'],
]

async function assertTruncateRejected(client, statement) {
    await client.query('savepoint identity_review_truncate_probe')
    try {
        await assert.rejects(
            () => client.query(statement),
            (error) => error?.code === 'P0001' && error?.message === 'identity review evidence is append-only',
        )
    } finally {
        // A rejected statement aborts its transaction until this rollback. If
        // the guard regresses and a truncate succeeds, this also undoes it.
        await client.query('rollback to savepoint identity_review_truncate_probe')
        await client.query('release savepoint identity_review_truncate_probe')
    }
}

test('local PostgreSQL proves append-only TRUNCATE and CASCADE protection without touching ledger data', {
    skip: !RUN_LOCAL_POSTGRES_INTEGRATION && 'Set SKINCOS_RUN_LOCAL_POSTGRES_INTEGRATION=1 for the local socket proof.',
    timeout: 20_000,
}, async () => {
    assert.equal(isStrictLocalMirrorDestination(LOCAL_SOCKET_URL), true)

    const pool = new pg.Pool({
        connectionString: LOCAL_SOCKET_URL,
        max: 1,
        application_name: 'crm-identity-review-ledger-integrity-test',
    })
    let client
    let transactionOpen = false
    try {
        client = await pool.connect()
        const destination = await client.query(`select current_database() as database_name, current_user as database_user,
            current_setting('transaction_read_only') as read_only`)
        assert.deepEqual(destination.rows, [{
            database_name: 'skincos_crm_local',
            database_user: 'admin',
            read_only: 'off',
        }])

        const triggerState = await client.query(`select expected.table_name, expected.trigger_name,
            exists(
                select 1
                from pg_trigger trigger
                join pg_class relation on relation.oid = trigger.tgrelid
                join pg_namespace namespace on namespace.oid = relation.relnamespace
                where namespace.nspname = 'crm_atendimento'
                  and relation.relname = expected.table_name
                  and trigger.tgname = expected.trigger_name
                  and trigger.tgenabled = 'O'
                  and trigger.tgfoid = to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
                  and trigger.tgtype::integer = 34
            ) as protected
            from (values
                ('identity_lineage', 'identity_lineage_no_truncate'),
                ('identity_member_history', 'identity_member_history_no_truncate'),
                ('identity_review_decisions', 'identity_review_decisions_no_truncate'),
                ('identity_source_link_history', 'identity_source_link_history_no_truncate')
            ) as expected(table_name, trigger_name)
            order by expected.table_name`)
        assert.deepEqual(
            triggerState.rows.map(({ table_name, trigger_name, protected: protectedTrigger }) => [table_name, trigger_name, protectedTrigger]),
            LEDGER_NO_TRUNCATE_TRIGGER_NAMES.map(([tableName, triggerName]) => [tableName, triggerName, true]),
        )

        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '2s'`)
        await client.query(`set local statement_timeout = '10s'`)
        await client.query(`create temporary table identity_review_truncate_probe_parent (
            id integer primary key
        ) on commit drop`)
        await client.query(`create temporary table identity_review_truncate_probe_child (
            id integer primary key,
            parent_id integer not null references identity_review_truncate_probe_parent(id)
        ) on commit drop`)
        await client.query(`create trigger identity_review_truncate_probe_child_no_truncate
            before truncate on identity_review_truncate_probe_child
            for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation()`)
        await client.query('insert into identity_review_truncate_probe_parent(id) values (1)')
        await client.query('insert into identity_review_truncate_probe_child(id, parent_id) values (1, 1)')

        await assertTruncateRejected(client, 'truncate table identity_review_truncate_probe_child')
        await assertTruncateRejected(client, 'truncate table identity_review_truncate_probe_parent cascade')

        const retained = await client.query(`select
            (select count(*)::integer from identity_review_truncate_probe_parent) as parents,
            (select count(*)::integer from identity_review_truncate_probe_child) as children`)
        assert.deepEqual(retained.rows, [{ parents: 1, children: 1 }])
    } finally {
        if (client) {
            if (transactionOpen) {
                try { await client.query('rollback') } catch { /* preserve the test failure */ }
            }
            client.release()
        }
        await pool.end()
    }
})
