import { describe, expect, it } from 'vitest'
import { verifyPontoPagesRemoteProject } from '../scripts/verify-ponto-pages-remote-project.mjs'

const project = 'skincos-ponto-staging'
const subdomain = `${project}.pages.dev`
const secretNames = [
  'PONTO_API_TARGET',
  'AUTH_API_TARGET',
  'INSUMOS_API_TARGET',
  'PONTO_ACTOR_HMAC_KEY',
  'PONTO_NETWORK_CONTEXT_KEY',
  'PONTO_RELEASE_PROBE_HMAC_KEY',
]
const plaintext = {
  SKINCOS_DEPLOYMENT_ENV: 'staging',
  PONTO_RELEASE_SHA: '1111111111111111111111111111111111111111',
  PONTO_ROLLOUT_STAGE: 'staging',
  PONTO_CORE_VERSION_ID: '22222222-2222-4222-8222-222222222222',
  PONTO_IDENTITY_VERSION_ID: '33333333-3333-4333-8333-333333333333',
}
const services = {
  PONTO_CORE: 'skincos-ponto-core-staging',
  PONTO_IDENTITY: 'skincos-insumos-staging',
}
const kvNamespaces = {
  MODULE_CONTROL: 'a'.repeat(32),
}

function response(domains: string[], production: Record<string, unknown> | null = null, preview: Record<string, unknown> | null = null) {
  return {
    success: true,
    result: {
      name: project,
      production_branch: 'main',
      subdomain,
      domains,
      source: null,
      deployment_configs: production === null && preview === null
        ? undefined
        : { production: production ?? {}, preview: preview ?? {} },
    },
  }
}

function secretEnvironment() {
  return Object.fromEntries(secretNames.map((name) => [name, { type: 'secret_text' }]))
}

function runtimeProduction() {
  return {
    compatibility_date: '2026-09-09',
    compatibility_flags: [],
    fail_open: false,
    env_vars: {
      ...secretEnvironment(),
      ...Object.fromEntries(Object.entries(plaintext).map(([name, value]) => [name, { type: 'plain_text', value }])),
    },
    services: {
      PONTO_CORE: { service: services.PONTO_CORE },
      PONTO_IDENTITY: { service: services.PONTO_IDENTITY },
    },
    kv_namespaces: {
      MODULE_CONTROL: { namespace_id: kvNamespaces.MODULE_CONTROL },
    },
  }
}

function runtimeExpectations() {
  return {
    expectedSecretNames: secretNames,
    expectedPlaintext: plaintext,
    expectedServices: services,
    expectedKvNamespaces: kvNamespaces,
    requireRuntimeMetadata: true,
  }
}

describe('dedicated Ponto Pages remote project identity', () => {
  it('accepts the Pages-owned subdomain and an empty dedicated project', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain]), project)).not.toThrow()
  })

  it('accepts exactly the production runtime configuration and leaves preview empty', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], runtimeProduction(), {}), project, runtimeExpectations())).not.toThrow()
  })

  it('rejects every custom domain while preserving the Pages-owned subdomain exception', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain, 'ponto.example.com']), project))
      .toThrow('PONTO_PAGES_REMOTE_CUSTOM_DOMAIN_PRESENT')
  })

  it('rejects undeclared environment values and type/value substitutions', () => {
    const secretsOnly = { env_vars: secretEnvironment() }
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], secretsOnly, {}), project, {
      expectedSecretNames: secretNames,
    })).not.toThrow()

    const extra = runtimeProduction()
    ;(extra.env_vars as Record<string, unknown>).UNDECLARED_PROVIDER_TOKEN = { type: 'secret_text' }
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], extra, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_ENVIRONMENT_BINDING_NAMES')

    const plainType = runtimeProduction()
    ;(plainType.env_vars as Record<string, { type: string }>).PONTO_API_TARGET = { type: 'plain_text' }
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], plainType, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_ENVIRONMENT_SECRET_PONTO_API_TARGET')

    const wrongValue = runtimeProduction()
    ;(wrongValue.env_vars as Record<string, { type: string, value: string }>).PONTO_ROLLOUT_STAGE.value = 'candidate'
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], wrongValue, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_ENVIRONMENT_PLAINTEXT_PONTO_ROLLOUT_STAGE')
  })

  it('rejects service, KV and every other remote binding family outside the Ponto contract', () => {
    const unexpectedService = runtimeProduction()
    ;(unexpectedService.services as Record<string, unknown>).SHARED_LEGACY = { service: 'skincos' }
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], unexpectedService, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_SERVICE_BINDING_NAMES')

    const wrongService = runtimeProduction()
    ;(wrongService.services as Record<string, { service: string }>).PONTO_CORE.service = 'skincos'
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], wrongService, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_SERVICE_BINDING_PONTO_CORE')

    const workerEnvironment = runtimeProduction()
    ;(workerEnvironment.services as Record<string, { environment?: string }>).PONTO_CORE.environment = 'production'
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], workerEnvironment, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_SERVICE_BINDING_PONTO_CORE')

    const wrongKv = runtimeProduction()
    ;(wrongKv.kv_namespaces as Record<string, { namespace_id: string }>).MODULE_CONTROL.namespace_id = 'b'.repeat(32)
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], wrongKv, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_KV_BINDING_MODULE_CONTROL')

    for (const field of [
      'ai_bindings',
      'analytics_engine_datasets',
      'browsers',
      'd1_databases',
      'durable_object_namespaces',
      'hyperdrive_bindings',
      'mtls_certificates',
      'queue_producers',
      'r2_buckets',
      'vectorize_bindings',
    ]) {
      const forbidden = runtimeProduction()
      forbidden[field] = { UNDECLARED: {} }
      expect(() => verifyPontoPagesRemoteProject(response([subdomain], forbidden, {}), project, runtimeExpectations()))
        .toThrow(`PONTO_PAGES_REMOTE_FORBIDDEN_BINDING_${field.toUpperCase()}`)
    }
  })

  it('rejects preview state and unsafe or unknown deployment configuration', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], runtimeProduction(), {
      env_vars: { PREVIEW_SECRET: { type: 'secret_text' } },
    }), project, runtimeExpectations())).toThrow('PONTO_PAGES_REMOTE_PREVIEW_ENVIRONMENT_BINDING_NAMES')

    const failOpen = runtimeProduction()
    failOpen.fail_open = true
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], failOpen, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_FAIL_OPEN_ENABLED')

    const unknown: Record<string, unknown> = runtimeProduction()
    unknown.unknown_binding_family = {}
    expect(() => verifyPontoPagesRemoteProject(response([subdomain], unknown, {}), project, runtimeExpectations()))
      .toThrow('PONTO_PAGES_REMOTE_CONFIG_FIELD_UNKNOWN_BINDING_FAMILY')
  })
})
