import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../migrationDestination.js'

test('migration target accepts local, staging, and dedicated production destinations', () => {
    assert.equal(isStrictAtendimentoMigrationDestination(
        'postgresql:///skincos_crm_local?host=/var/run/postgresql',
        ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
    ), true)
    assert.equal(isStrictAtendimentoMigrationDestination(
        'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true&application_name=atendimento-migration',
        ATENDIMENTO_MIGRATION_TARGETS.STAGING,
    ), true)
    assert.equal(isStrictAtendimentoMigrationDestination(
        'postgresql://skincos_clientes_migrator_login:synthetic@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true&application_name=atendimento-migration',
        ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
    ), true)
})

test('migration target rejects remote, non-TLS, wrong-role and wrong-database destinations', () => {
    const rejected = [
        'postgresql://skincos_staging_migrator_login:synthetic@db.example.test:5432/skincos_staging?sslmode=require',
        'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=disable',
        'postgresql://skincos_staging_crm_app:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require',
        'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_crm_local?sslmode=require',
    ]
    for (const value of rejected) assert.equal(isStrictAtendimentoMigrationDestination(value, ATENDIMENTO_MIGRATION_TARGETS.STAGING), false, value)
    assert.equal(isStrictAtendimentoMigrationDestination(
        'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true',
        ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
    ), false)
    assert.equal(isStrictAtendimentoMigrationDestination(
        'postgresql://skincos_clientes_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
        ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
    ), false)
})
