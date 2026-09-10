import { readFile } from 'node:fs/promises'

const BINDING_MAP_NAMES = [
  'ai_bindings',
  'analytics_engine_datasets',
  'browsers',
  'd1_databases',
  'durable_object_namespaces',
  'hyperdrive_bindings',
  'kv_namespaces',
  'mtls_certificates',
  'queue_producers',
  'r2_buckets',
  'services',
  'vectorize_bindings',
]

// A direct Pages upload applies its Wrangler configuration remotely. Reject a
// newly returned deployment-configuration field until it has been reviewed:
// accepting an unknown binding family would silently weaken the Ponto-only
// boundary.
const KNOWN_DEPLOYMENT_CONFIG_FIELDS = new Set([
  'always_use_latest_compatibility_date',
  'build_image_major_version',
  'compatibility_date',
  'compatibility_flags',
  'env_vars',
  'fail_open',
  'usage_model',
  'limits',
  'placement',
  'wrangler_config_hash',
  ...BINDING_MAP_NAMES,
])

const SERVICE_BINDING_FIELDS = new Set(['service', 'environment', 'entrypoint'])
const KV_BINDING_FIELDS = new Set(['namespace_id'])

function fail(code) {
  throw new Error(`PONTO_PAGES_REMOTE_${code}`)
}

function scopeCode(scope, code) {
  return scope === 'production' ? code : `${scope.toUpperCase()}_${code}`
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function configuredMap(config, name, scope) {
  const configured = config[name]
  if (configured === undefined || configured === null) return {}
  if (!isMap(configured)) fail(scopeCode(scope, `${name.toUpperCase()}_CONFIG_UNREADABLE`))
  return configured
}

function exactKeys(actual, expected, scope, code) {
  if (!sameList(Object.keys(actual).sort(), Object.keys(expected).sort())) fail(scopeCode(scope, code))
}

function deploymentConfig(project, scope) {
  const configs = project?.deployment_configs
  if (configs === undefined || configs === null) return {}
  if (!isMap(configs)) fail('DEPLOYMENT_CONFIGS_UNREADABLE')
  const configured = configs[scope]
  if (configured === undefined || configured === null) return {}
  if (!isMap(configured)) fail(scopeCode(scope, 'CONFIG_UNREADABLE'))
  for (const key of Object.keys(configured)) {
    if (!KNOWN_DEPLOYMENT_CONFIG_FIELDS.has(key)) {
      fail(scopeCode(scope, `CONFIG_FIELD_${key.toUpperCase()}`))
    }
  }
  return configured
}

function verifySafeMetadata(config, scope, { requireRuntimeMetadata }) {
  if (config.fail_open === true) fail(scopeCode(scope, 'FAIL_OPEN_ENABLED'))
  if (config.always_use_latest_compatibility_date === true) {
    fail(scopeCode(scope, 'LATEST_COMPATIBILITY_DATE_ENABLED'))
  }
  if (config.compatibility_flags !== undefined
    && (!Array.isArray(config.compatibility_flags) || config.compatibility_flags.length !== 0)) {
    fail(scopeCode(scope, 'COMPATIBILITY_FLAGS_PRESENT'))
  }
  if (config.limits !== undefined && config.limits !== null) fail(scopeCode(scope, 'LIMITS_PRESENT'))
  if (config.placement !== undefined && config.placement !== null) fail(scopeCode(scope, 'PLACEMENT_PRESENT'))
  if (requireRuntimeMetadata) {
    const compatibilityDate = String(config.compatibility_date || '')
    if (!/^2026-09-09(?:T00:00:00(?:\.000)?Z)?$/.test(compatibilityDate)) {
      fail(scopeCode(scope, 'COMPATIBILITY_DATE'))
    }
  }
}

function verifyDeclaredEnvironment(config, scope, expectedSecretNames, expectedPlaintext) {
  const envVars = configuredMap(config, 'env_vars', scope)
  const secretNames = [...new Set(expectedSecretNames)].sort()
  if (secretNames.length !== expectedSecretNames.length) fail('EXPECTED_SECRET_NAMES_DUPLICATE')
  if (!isMap(expectedPlaintext)) fail('EXPECTED_PLAINTEXT_ENVIRONMENT_INVALID')
  const plaintextNames = Object.keys(expectedPlaintext).sort()
  if (secretNames.some((name) => Object.hasOwn(expectedPlaintext, name))) fail('EXPECTED_ENVIRONMENT_NAME_COLLISION')
  const expectedNames = [...secretNames, ...plaintextNames].sort()
  if (!sameList(Object.keys(envVars).sort(), expectedNames)) fail(scopeCode(scope, 'ENVIRONMENT_BINDING_NAMES'))
  for (const name of secretNames) {
    if (envVars[name]?.type !== 'secret_text') fail(scopeCode(scope, `ENVIRONMENT_SECRET_${name}`))
  }
  for (const name of plaintextNames) {
    if (envVars[name]?.type !== 'plain_text' || envVars[name]?.value !== expectedPlaintext[name]) {
      fail(scopeCode(scope, `ENVIRONMENT_PLAINTEXT_${name}`))
    }
  }
}

function verifyServiceBindings(config, scope, expectedServices) {
  if (!isMap(expectedServices)) fail('EXPECTED_SERVICE_BINDINGS_INVALID')
  const services = configuredMap(config, 'services', scope)
  exactKeys(services, expectedServices, scope, 'SERVICE_BINDING_NAMES')
  for (const [binding, expectedService] of Object.entries(expectedServices)) {
    const actual = services[binding]
    if (!isMap(actual)
      || Object.keys(actual).some((key) => !SERVICE_BINDING_FIELDS.has(key))
      || actual.service !== expectedService
      || (actual.environment !== undefined && actual.environment !== null && actual.environment !== '')
      || (actual.entrypoint !== undefined && actual.entrypoint !== null && actual.entrypoint !== '')) {
      fail(scopeCode(scope, `SERVICE_BINDING_${binding}`))
    }
  }
}

function verifyKvBindings(config, scope, expectedKvNamespaces) {
  if (!isMap(expectedKvNamespaces)) fail('EXPECTED_KV_BINDINGS_INVALID')
  const namespaces = configuredMap(config, 'kv_namespaces', scope)
  exactKeys(namespaces, expectedKvNamespaces, scope, 'KV_BINDING_NAMES')
  for (const [binding, namespaceId] of Object.entries(expectedKvNamespaces)) {
    const actual = namespaces[binding]
    if (!isMap(actual)
      || Object.keys(actual).some((key) => !KV_BINDING_FIELDS.has(key))
      || actual.namespace_id !== namespaceId) {
      fail(scopeCode(scope, `KV_BINDING_${binding}`))
    }
  }
}

function verifyNoUnexpectedBindingFamilies(config, scope) {
  for (const name of BINDING_MAP_NAMES) {
    if (name === 'services' || name === 'kv_namespaces') continue
    if (Object.keys(configuredMap(config, name, scope)).length !== 0) {
      fail(scopeCode(scope, `FORBIDDEN_BINDING_${name.toUpperCase()}`))
    }
  }
}

function verifyConfig(config, scope, {
  expectedSecretNames,
  expectedPlaintext,
  expectedServices,
  expectedKvNamespaces,
  requireRuntimeMetadata,
}) {
  verifySafeMetadata(config, scope, { requireRuntimeMetadata })
  verifyDeclaredEnvironment(config, scope, expectedSecretNames, expectedPlaintext)
  verifyServiceBindings(config, scope, expectedServices)
  verifyKvBindings(config, scope, expectedKvNamespaces)
  verifyNoUnexpectedBindingFamilies(config, scope)
}

export function verifyPontoPagesRemoteProject(response, expectedProject, {
  expectedSecretNames = [],
  expectedPlaintext = {},
  expectedServices = {},
  expectedKvNamespaces = {},
  requireRuntimeMetadata = false,
} = {}) {
  const project = response?.result
  const expectedSubdomain = `${expectedProject}.pages.dev`

  if (response?.success !== true || !project) fail('PROJECT_UNREADABLE')
  if (project.name !== expectedProject) fail('PROJECT_NAME_MISMATCH')
  if (project.production_branch !== 'main') fail('PROJECT_BRANCH_MISMATCH')
  if (project.subdomain !== expectedSubdomain) fail('PROJECT_SUBDOMAIN_MISMATCH')
  if (!Array.isArray(project.domains) || project.domains.some((domain) => domain !== expectedSubdomain)) {
    fail('CUSTOM_DOMAIN_PRESENT')
  }

  const source = project.source
  const sourceConfig = source?.config
  const directUploadOnly = source === null
  const disabledGitPublication = sourceConfig
    && sourceConfig.deployments_enabled === false
    && sourceConfig.production_deployments_enabled === false
    && sourceConfig.preview_deployment_setting === 'none'
  if (!directUploadOnly && !disabledGitPublication) fail('GIT_PUBLICATION_NOT_DISABLED')

  verifyConfig(deploymentConfig(project, 'production'), 'production', {
    expectedSecretNames,
    expectedPlaintext,
    expectedServices,
    expectedKvNamespaces,
    requireRuntimeMetadata,
  })
  verifyConfig(deploymentConfig(project, 'preview'), 'preview', {
    expectedSecretNames: [],
    expectedPlaintext: {},
    expectedServices: {},
    expectedKvNamespaces: {},
    // Top-level compatibility metadata is inherited by Pages preview even
    // when all runtime bindings are scoped to env.production. Preview must
    // stay binding-free, but need not duplicate the production date check.
    requireRuntimeMetadata: false,
  })
}

function runtimeExpectations() {
  const required = (name) => {
    if (!Object.hasOwn(process.env, name)) fail(`RUNTIME_EXPECTATION_${name}_MISSING`)
    return process.env[name]
  }
  return {
    expectedPlaintext: {
      SKINCOS_DEPLOYMENT_ENV: required('PONTO_PAGES_EXPECTED_RUNTIME_ENVIRONMENT'),
      PONTO_RELEASE_SHA: required('PONTO_PAGES_EXPECTED_RELEASE_SHA'),
      PONTO_ROLLOUT_STAGE: required('PONTO_PAGES_EXPECTED_ROLLOUT_STAGE'),
      PONTO_CORE_VERSION_ID: required('PONTO_PAGES_EXPECTED_CORE_VERSION_ID'),
      PONTO_IDENTITY_VERSION_ID: required('PONTO_PAGES_EXPECTED_IDENTITY_VERSION_ID'),
    },
    expectedServices: {
      PONTO_CORE: required('PONTO_PAGES_EXPECTED_CORE_SERVICE'),
      PONTO_IDENTITY: required('PONTO_PAGES_EXPECTED_IDENTITY_SERVICE'),
    },
    expectedKvNamespaces: {
      MODULE_CONTROL: required('PONTO_PAGES_EXPECTED_MODULE_CONTROL_KV_ID'),
    },
    requireRuntimeMetadata: true,
  }
}

async function main() {
  const [file, expectedProject, mode = 'empty', ...expectedSecretNames] = process.argv.slice(2)
  if (!file || !expectedProject) fail('PROJECT_INPUT_MISSING')
  if (!['empty', 'secrets', 'runtime'].includes(mode)) fail('MODE_INVALID')
  if (mode === 'empty' && expectedSecretNames.length !== 0) fail('EMPTY_MODE_ARGUMENTS')
  if (mode === 'secrets' && expectedSecretNames.length === 0) fail('SECRETS_MODE_ARGUMENTS')
  const response = JSON.parse(await readFile(file, 'utf8'))
  verifyPontoPagesRemoteProject(response, expectedProject, {
    expectedSecretNames,
    ...(mode === 'runtime' ? runtimeExpectations() : {}),
  })
}

if (process.argv[1] && process.argv[1].endsWith('verify-ponto-pages-remote-project.mjs')) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n')
    process.exitCode = 1
  })
}
