/**
 * Versioned architecture and release contract for Influencer Intelligence.
 *
 * Runtime registration is described as a separate, disabled operational
 * surface. This manifest never opens a socket, calls a provider, reads a
 * secret, or activates a workflow; it records the current source/runtime gate
 * so release evidence cannot confuse registration with activation.
 */

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

export const INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION =
  'influencer-intelligence-architecture/v1';

export const DOMAIN_ROOT = 'social/influencer-intelligence';

export const FEATURE_ACCESS = deepFreeze({
  flag: 'INFLUENCER_INTELLIGENCE_ENABLED',
  defaultValue: false,
  initialMode: 'off',
  grant: 'module.influencer-intelligence.access',
  serverSideOnly: true,
  wired: false,
});

export const BOUNDARIES = deepFreeze([
  {
    id: 'instagram-infrastructure',
    owner: 'social/instagram',
    owns: ['existing OAuth and connection state', 'existing read transports', 'existing session lifecycle', 'existing publication and engagement surfaces'],
    mayExpose: ['bounded read-only provider transport to an approved adapter'],
    mustNotOwn: ['Influencer Intelligence scores', 'Influencer Intelligence snapshots', 'CRM campaign-fit decisions'],
  },
  {
    id: 'influencer-intelligence',
    owner: DOMAIN_ROOT,
    owns: ['normalized evidence contracts', 'creator registry', 'append-only snapshots', 'bounded content features', 'analytics', 'scores', 'campaign-fit projections', 'provenance'],
    mayConsume: ['approved provider adapters', 'PostgreSQL read/write roles introduced by later milestones'],
    mustNotConsumeDirectly: ['provider credentials', 'raw provider payloads', 'raw comments or media', 'shell commands', 'live workflow JSON'],
  },
  {
    id: 'provider-router',
    owner: DOMAIN_ROOT,
    owns: ['provider ordering', 'explicit gap classification', 'bounded adapter projection', 'timeout and safe retry', 'per-provider operation circuit state'],
    order: ['meta-graph', 'instagrapi'],
    fallbackOnlyFor: ['provider_unavailable', 'permission_gap', 'coverage_gap', 'timeout', 'circuit_open', 'retry_exhausted'],
    failClosedFor: ['policy_block', 'invalid_response', 'unclassified_transport'],
    retryPolicy: 'Only bounded provider_unavailable, transport_error, rate_limited, and timeout failures may retry; policy and invalid responses never retry.',
    circuitPolicy: 'Failures are isolated by provider and operation; an open circuit is a fallback gap and never produces data.',
    externalPolicy: 'Future external providers require explicit configuration and allowlisting after a measured gap review.',
  },
  {
    id: 'token-vault',
    owner: 'platform/security/token-vault',
    owns: ['credential custody', 'least-privilege provider access', 'secret audit'],
    sourceImplementation: 'platform/security/token-vault/src/analytics-readonly.js exposes a separate fixed read-only analytics action and allowlist.',
    operationalGate: 'Staging secret, scoped Instagram credential, deployment checkpoint, and read-only smoke evidence are required before runtime collection.',
    mustNotReturnToDomain: ['credential material', 'session material', 'unbounded connection payloads'],
  },
  {
    id: 'internal-service',
    owner: 'future Influencer Intelligence service',
    owns: ['authentication', 'grant checks', 'request validation', 'read-only envelopes', 'correlation'],
    mustNotExpose: ['raw provider payloads', 'arbitrary SQL', 'arbitrary shell', 'engagement or publication actions'],
  },
  {
    id: 'mcp',
    owner: 'independent Orb repository read-only gateway contract',
    owns: ['authenticated tool presentation', 'sanitization', 'bounded read-only invocation', 'rate limits', 'timeouts', 'audit'],
    delegatesTo: 'internal Influencer Intelligence service',
    mustNotDo: ['scrape', 'publish', 'engage', 'execute arbitrary SQL', 'execute arbitrary shell', 'mutate workflows'],
  },
  {
    id: 'crm',
    owner: 'crm',
    owns: ['read-only module contract', 'dashboard projection', 'server-side module authorization'],
    consumes: 'versioned internal API envelope',
    mustNotDo: ['call Meta Graph directly', 'call instagrapi directly', 'infer authorization from navigation visibility'],
  },
  {
    id: 'orb',
    owner: 'independent Orb repository',
    owns: ['schedule', 'retry', 'resume', 'job correlation', 'operator recovery'],
    mustNotDo: ['become a provider', 'compute scores', 'own domain snapshots', 'import stale local workflow JSON as live truth'],
  },
]);

export const PROVIDER_INTERFACE = deepFreeze({
  contractVersion: 'influencer-intelligence/provider-interface/v1',
  request: {
    required: ['operation', 'observedAt', 'retrievedAt', 'correlationId'],
    identityRules: ['resolve_creator requires canonicalHandle', 'all other operations require creatorKey', 'get_media_metrics requires bounded mediaKeys'],
    optional: ['creatorKey', 'canonicalHandle', 'window', 'limit', 'mediaKeys', 'metricSet', 'requestedFields'],
    forbidden: ['rawProviderAccountReference', 'credentialMaterial', 'sessionMaterial', 'rawQuery', 'engagementAction'],
  },
  result: {
    statuses: ['ok', 'unavailable'],
    fields: ['provider', 'retrievedAt', 'dataClassification', 'freshness', 'limitations', 'providerSpecificEvidence', 'data'],
    forbidden: ['rawProviderPayload', 'directContactFields', 'rawCommentText', 'mediaBinary', 'credentialMaterial'],
  },
  operations: [
    { name: 'resolve_creator', readOnly: true, lifecycle: 'provider identity resolution; bounded public handle projection' },
    { name: 'get_profile', readOnly: true, lifecycle: 'bounded profile projection through the approved Token Vault Meta Graph transport when the runtime gate is enabled' },
    { name: 'get_recent_media', readOnly: true, lifecycle: 'bounded media identity projection through the approved read-only transport; no binary archive' },
    { name: 'get_media_metrics', readOnly: true, lifecycle: 'bounded media metrics projection; unavailable when coverage is missing' },
    { name: 'get_comments_sample', readOnly: true, lifecycle: 'aggregate/sample intelligence only; no raw comment text' },
    { name: 'get_profile_metrics', readOnly: true, lifecycle: 'bounded profile aggregate metrics; unavailable when not supplied' },
  ],
  providerIdentity: {
    allowed: ['meta-graph', 'instagrapi'],
    officialFirst: 'meta-graph',
    futureProviders: 'Only explicitly configured and allowlisted after a measured, documented gap and a separate review.',
  },
});

export const DATA_MODEL = deepFreeze({
  schema: 'influencer_intelligence',
  identity: {
    creatorKey: 'opaque internal key',
    canonicalHandle: 'optional normalized public handle',
    providerAccount: 'SHA-256 digest only in the registry; raw provider identity stays inside the approved transport boundary',
  },
  resources: [
    {
      name: 'creator_registry',
      lifecycle: 'minimal operational binding; current state may transition under explicit policy',
      fields: ['creatorKey', 'canonicalHandle', 'registryState', 'monitoringEnabled', 'monitoringIntervalHours', 'createdAt', 'updatedAt'],
    },
    {
      name: 'creator_provider_registry',
      lifecycle: 'minimal provider binding; current availability only',
      fields: ['creatorKey', 'provider', 'providerAccountDigest', 'providerState', 'evidenceState', 'lastObservedAt', 'lastRetrievedAt', 'sourceRef'],
    },
    {
      name: 'provider_snapshots',
      lifecycle: 'append-only',
      fields: ['snapshotKey', 'creatorKey', 'provider', 'providerAdapterVersion', 'observedAt', 'retrievedAt', 'contractVersion', 'retentionPolicyVersion'],
    },
    {
      name: 'metric_observations',
      lifecycle: 'append-only child of a snapshot',
      fields: ['snapshotKey', 'metricKey', 'unit', 'value', 'evidenceState', 'confidence', 'provenance'],
    },
    {
      name: 'analytics_results',
      lifecycle: 'append-only derived artifact; recomputation creates a new version',
      fields: ['analysisKey', 'creatorKey', 'window', 'inputSnapshotKeys', 'algorithmVersion', 'coverage', 'provenance', 'computedAt'],
    },
    {
      name: 'content_analysis_features',
      lifecycle: 'append-only derived projection stored inside creator_analysis.analysis_metrics',
      fields: ['sampleKey', 'contentKeys', 'topics', 'productCategories', 'brandsMentioned', 'competitors', 'sponsoredSignal', 'promotionCouponSignal', 'skincareAffinity', 'educationVsEntertainment', 'claimTypes', 'contentFormat', 'brandSafetyFlags', 'algorithmVersion', 'modelVersion', 'evidenceRefs'],
    },
    {
      name: 'score_snapshots',
      lifecycle: 'append-only derived artifact',
      fields: ['scoreKey', 'creatorKey', 'scoreKind', 'score', 'confidence', 'coverage', 'evidenceState', 'providers', 'provenance', 'timestamp', 'algorithmVersion', 'weightsVersion', 'signals'],
    },
    {
      name: 'structured_signals',
      lifecycle: 'append-only evidence-bearing projection',
      fields: ['key', 'value', 'evidenceState', 'confidence', 'evidenceRefs', 'modelVersion'],
    },
  ],
  persistence: {
    migration: 'migrations/20260811_influencer_intelligence_data_model_v1.up.sql',
    additiveMigrations: [
      'migrations/20260812_influencer_intelligence_comments_v1.up.sql',
      'migrations/20260812_influencer_intelligence_campaign_fit_v1.up.sql',
      'migrations/20260812_influencer_intelligence_snapshot_fencing_v1.up.sql',
    ],
    dependsOn: 'migrations/20260810_influencer_intelligence_registry_v1.up.sql',
    artifactStatus: 'source-controlled additive artifacts; applied in staging only; production remains unapplied',
    appendOnlyRelations: [
      'collector_evidence',
      'creator_profile_snapshot',
      'creator_media_snapshot',
      'creator_comment_sample',
      'creator_analysis',
      'creator_score',
      'creator_score_component',
      'campaign_creator_fit',
    ],
    relations: [
      { name: 'creator_identity', concept: 'creator identity', lifecycle: 'current provider binding with observed provenance' },
      { name: 'collector_run', concept: 'collector run', lifecycle: 'idempotent operational execution metadata' },
      { name: 'creator_media', concept: 'media identity', lifecycle: 'current provider-neutral media identity' },
      { name: 'collector_evidence', concept: 'collector evidence', lifecycle: 'append-only provenance and gap record' },
      { name: 'creator_profile_snapshot', concept: 'profile snapshot', lifecycle: 'append-only observed profile projection' },
      { name: 'creator_media_snapshot', concept: 'media snapshot', lifecycle: 'append-only observed media metrics' },
      { name: 'creator_comment_sample', concept: 'comment sample', lifecycle: 'append-only aggregate-only intelligence' },
      { name: 'creator_analysis', concept: 'creator analysis', lifecycle: 'append-only derived time-window artifact' },
      { name: 'creator_score', concept: 'creator score', lifecycle: 'append-only deterministic score envelope' },
      { name: 'creator_score_component', concept: 'score component', lifecycle: 'append-only explainable score component' },
      { name: 'campaign', concept: 'campaign criteria', lifecycle: 'versioned current criteria; no dispatch' },
      { name: 'campaign_creator_fit', concept: 'campaign fit', lifecycle: 'append-only derived creator/campaign projection', fields: ['campaignKey', 'campaignVersion', 'creatorKey', 'campaignFitScore', 'confidence', 'coverage', 'evidenceState', 'components', 'weightsVersion', 'algorithmVersion', 'provenance', 'computedAt'] },
    ],
  },
  invariants: [
    'Unavailable values are null and are never silently imputed as zero.',
    'Historical provider snapshots, observations, analytics results, scores, and signals are never updated in place.',
    'The registry is not a raw provider cache.',
    'Every historical artifact carries a retention policy version.',
    'Every ingested historical artifact has an idempotent ingest key and a bounded provider/source provenance.',
    'Persistence accepts future provider slugs without widening the current runtime provider allowlist.',
    'The data-model migration depends on the M1 registry and remains unapplied until destination gates exist.',
  ],
});

export const PROVENANCE_CONTRACT = deepFreeze({
  contractVersion: 'influencer-intelligence/provenance/v1',
  evidenceStates: ['observed', 'derived', 'inferred', 'unavailable'],
  requiredFields: ['contractVersion', 'provider', 'sourceType', 'evidenceState', 'observedAt', 'retrievedAt', 'sourceRef'],
  optionalFields: ['providerAdapterVersion', 'algorithmVersion', 'modelVersion', 'evidenceRefs'],
  sourceRef: 'opaque bounded path without query strings or fragments',
  coverage: {
    fields: ['availableMetrics', 'expectedMetrics', 'ratio'],
    ratioRule: 'ratio is computed by the service from availableMetrics / expectedMetrics',
    zeroRule: 'missing coverage is unavailable, not zero performance',
  },
  stateRules: {
    observed: 'provider returned or directly measured the scalar',
    derived: 'deterministic computation from versioned observed inputs',
    inferred: 'bounded interpretation with confidence, evidence references, and model version when model-derived',
    unavailable: 'provider, permission, or coverage did not supply the signal; value must be null',
  },
});

export const SCORE_CONTRACT = deepFreeze({
  contractVersion: 'influencer-intelligence/score/v1',
  requiredFields: ['scoreKind', 'score', 'confidence', 'coverage', 'evidenceState', 'providers', 'provenance', 'timestamp', 'algorithmVersion', 'weightsVersion', 'signals'],
  ranges: { score: '0..100 or null', confidence: '0..1', coverageRatio: '0..1' },
  scoreKinds: ['influencer', 'campaign-fit', 'brand-fit', 'risk'],
  deterministicFirst: true,
  followerRule: 'absolute follower count is an observed scale signal, never a quality score',
  robustnessRule: 'time-bounded post-level robust statistics must cap viral outlier influence',
  riskRule: 'indirect evidence may produce an inferred suspicious-pattern signal, never a factual fake-followers claim',
  llmRule: 'LLM output is structured and auditable; free-form prompt, completion, or rationale text is not persisted',
  unavailableRule: 'no provider or insufficient coverage yields an explicit unavailable result, not a fabricated score',
});

export const API_CONTRACT = deepFreeze({
  contractVersion: 'influencer-intelligence/api/v1',
  exposure: 'internal authenticated service contract; registered on loopback only and disabled by default',
  authorization: {
    session: true,
    serverSideFlag: FEATURE_ACCESS.flag,
    grant: FEATURE_ACCESS.grant,
    scope: 'explicit actor and data scope; navigation is not authorization',
  },
  responseEnvelope: ['contractVersion', 'requestId', 'generatedAt', 'data', 'coverage', 'provenance', 'errors'],
  routes: [
    {
      method: 'POST',
      path: '/internal/influencer-intelligence/v1/creators',
      readOnly: false,
      caller: 'CRM-authenticated registry request',
      purpose: 'Register a bounded canonical handle as a creator candidate; no provider resolution or collection is started by this request.',
      controls: ['server-side flag', 'explicit grant', 'internal authentication', 'handle allowlist', 'idempotency', 'redacted audit'],
    },
    {
      method: 'POST',
      path: '/internal/influencer-intelligence/v1/snapshots',
      readOnly: false,
      caller: 'Orb-only controlled collection operation',
      purpose: 'Dispatch bounded snapshot_creator and snapshot_creator_media operations through the internal service; persist collector_run and append-only evidence.',
      controls: ['server-side flag', 'workflow grant', 'internal authentication', 'bounded operation schema', 'lease', 'idempotency', 'redacted audit'],
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/analysis',
      readOnly: true,
      caller: 'MCP/internal read transport',
      purpose: 'Return a versioned analysis envelope for one creator.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/dashboard',
      readOnly: true,
      caller: 'CRM signed upstream only',
      purpose: 'Return an assembled read-only dashboard projection; the public CRM analysis path maps here.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/coverage',
      readOnly: true,
      purpose: 'Return data availability and provenance coverage without provider payloads.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/profile',
      readOnly: true,
      caller: 'MCP internal transport',
      purpose: 'Return the latest persisted profile projection without contacting a provider.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/snapshots',
      readOnly: true,
      caller: 'MCP internal transport',
      purpose: 'Return bounded append-only profile history.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/media',
      readOnly: true,
      caller: 'MCP internal transport',
      purpose: 'Return bounded persisted media metrics without media binaries.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/score',
      readOnly: true,
      caller: 'MCP internal transport',
      purpose: 'Return the latest persisted deterministic score and components.',
    },
    {
      method: 'POST',
      path: '/internal/influencer-intelligence/v1/compare',
      readOnly: true,
      purpose: 'Compute a bounded comparison from creator keys and a time window; POST is query transport, not mutation.',
    },
    {
      method: 'POST',
      path: '/internal/influencer-intelligence/v1/campaign-fit',
      readOnly: true,
      purpose: 'Return a bounded persisted campaign-fit projection; computation is a separate controlled service operation and no campaign is created or dispatched.',
    },
  ],
  requestRules: {
    maxCreatorsPerRequest: 20,
    maxWindowDays: 365,
    acceptedIdentity: ['opaque creatorKey', 'approved canonical handle resolver', 'bounded canonical handle registration'],
    rejectedInput: ['provider account ids', 'credential material', 'raw comment text', 'raw media', 'arbitrary query fragments'],
  },
  errorCodes: ['AUTH_REQUIRED', 'GRANT_REQUIRED', 'INVALID_INPUT', 'NOT_FOUND', 'UNAVAILABLE', 'RATE_LIMITED', 'UPSTREAM_GAP', 'INTERNAL'],
});

export const MCP_CONTRACT = deepFreeze({
  contractVersion: 'influencer-intelligence/mcp/v1.1',
  transport: 'domain adapter for the authenticated external Orb read-only gateway contract; MCP is not a provider transport',
  controls: ['authentication', 'server-side grant', 'schema sanitization', 'bounded input', 'rate limit', 'timeout and abort', 'audit event', 'read-only database role', 'redacted output'],
  limits: { maxRequestBytes: 65536, maxResponseBytes: 524288, maxPageSize: 50, maxCreatorsPerRequest: 20, maxWindowDays: 365, maxConcurrentRequests: 4, timeoutMs: 12000, rateLimitPerMinute: 60 },
  tools: [
    { name: 'search_creators', readOnly: true, input: ['query', 'provider', 'registry_state', 'page', 'page_size'] },
    { name: 'get_creator_profile', readOnly: true, input: ['creator_key'] },
    { name: 'get_creator_snapshots', readOnly: true, input: ['creator_key', 'window', 'page', 'page_size'] },
    { name: 'get_creator_media', readOnly: true, input: ['creator_key', 'window', 'page', 'page_size'] },
     { name: 'get_creator_analytics', readOnly: true, input: ['creator_key', 'window'] },
     { name: 'get_creator_score', readOnly: true, input: ['creator_key'] },
     { name: 'get_campaign_fit', readOnly: true, input: ['campaign_key', 'campaign_version', 'creator_keys', 'page', 'page_size'] },
     { name: 'compare_creators', readOnly: true, input: ['creator_keys', 'window'] },
   ],
  deferredTools: [],
  forbidden: ['arbitrary SQL', 'arbitrary shell', 'scraping', 'provider credential retrieval', 'publication', 'engagement', 'workflow mutation', 'raw comment or media output'],
  output: ['versioned response envelope', 'data classification', 'freshness', 'confidence', 'coverage', 'provenance', 'requestId', 'sanitized errors'],
});

export const RELEASE_CONTRACT = deepFreeze({
  module: 'social',
  maturity: 'experimental',
  flag: FEATURE_ACCESS.flag,
  flagDefault: 'false',
  grant: FEATURE_ACCESS.grant,
  rollout: ['off', 'shadow', 'active'],
  shadow: 'synthetic fixtures or explicitly approved staging only; no real-user activation',
  activation: 'requires immutable release SHA, explicit flag, explicit grant, data scope, pre-production evidence, smoke, and rollback identity',
  mergeRule: 'merge, CI, health, or navigation visibility never activates the domain',
  architecturePrScope: {
    runtimeEnabled: false,
    migrationApplied: false,
    providerCalls: false,
    crmRegistered: false,
    mcpRegistered: false,
    orbWorkflowChanged: false,
  },
  currentSourceScope: {
    internalServiceSourceAdded: true,
    internalServiceRuntimeRegistered: true,
    internalServiceRuntimeEnabled: false,
    schedulerSourceAdded: true,
    schedulerWorkflowImported: false,
    schedulerWorkflowActive: false,
    schedulerMigrationArtifactAdded: true,
    mcpSourceAdded: true,
    mcpRuntimeRegistered: true,
    mcpRuntimeEnabled: false,
    crmSourceAdded: true,
    crmRuntimeEnabled: false,
    crmUpstreamConfigured: true,
    crmFeatureFlagDefault: false,
    orbRuntimeRegistered: true,
    orbWorkflowImported: false,
    orbWorkflowActive: false,
    analyticsTransportSourceAdded: true,
    analyticsTransportStagingDeployed: false,
    analyticsRuntimeProviderCalls: false,
    migrationRunnerSourceAdded: true,
    migrationStagingApplied: true,
    migrationRuntimeGrant: false,
    commentsSourceAdded: true,
    commentsMigrationArtifactAdded: true,
    commentsRuntimeWired: false,
    contentSourceAdded: true,
     contentRuntimeWired: false,
     campaignFitSourceAdded: true,
     campaignFitMigrationArtifactAdded: true,
     campaignFitRuntimeWired: false,
     calibrationSourceAdded: true,
     calibrationDatasetVersion: 'influencer-intelligence-calibration-golden/v1',
     calibrationRuntimeWired: false,
     gapAnalysisSourceAdded: true,
     externalProviderIntegrated: false,
  },
  runtimeRegistration: {
    version: 'influencer-intelligence/runtime-registration/v1',
    serviceUnit: 'ops/runtime/units/influencer-intelligence.service',
    mcpUnit: 'ops/runtime/units/influencer-intelligence-mcp.service',
    installer: 'scripts/runtime/install-influencer-intelligence-runtime.sh',
    registrationMarker: 'INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED=true',
    defaultFlag: false,
    unitsEnabledByInstaller: false,
    listeners: ['127.0.0.1:8899', '127.0.0.1:8767'],
    providerCalls: false,
    instagramWrite: false,
    orbWorkflowImported: false,
    rollback: 'disable both units, restore the prior immutable release, and preserve the private env file; no migration rollback is required',
  },
});

export const PRIVACY_CONTRACT = deepFreeze({
  retained: ['opaque creator key', 'optional normalized public handle', 'scalar metric observations', 'aggregate comments signals', 'bounded content features', 'provider account digest', 'bounded provenance and audit metadata'],
  neverPersisted: ['raw provider account identity', 'raw profile payload', 'direct contact fields', 'credential material', 'cookies or sessions', 'raw comment text by default', 'raw captions or transcripts', 'raw media, frame binaries, or download paths', 'unbounded model prompts or completions', 'simulator output as observed evidence'],
  comments: 'store bounded topic, sentiment, safety, spam, and coverage aggregates; raw text requires a separate privacy decision',
  retention: 'every historical artifact names a reviewed retentionPolicyVersion and finite retention class; no indefinite raw cache',
  deletion: 'privacy deletion or tombstoning is a separate controlled policy; it must not rewrite historical evidence silently',
  language: 'indirect signals are labeled inferred and may not be presented as facts about fake followers or identity',
});

export const OBSERVABILITY_CONTRACT = deepFreeze({
  auditEventFields: ['requestId', 'correlationId', 'actorScope', 'grant', 'operation', 'provider', 'providerAttemptStatus', 'reasonCode', 'latencyMs', 'timeout', 'fallbackUsed', 'coverage', 'algorithmVersion', 'resultKey', 'at'],
  metrics: ['request_count', 'request_latency_ms', 'provider_attempt_count', 'provider_gap_count', 'fallback_count', 'unavailable_count', 'coverage_ratio', 'score_generation_count', 'rate_limited_count', 'timeout_count'],
  logging: 'redacted structured logs only; no credentials, sessions, raw payloads, raw comments, direct contact fields, or unrestricted model text',
  alerts: ['unexpected provider fallback increase', 'coverage regression', 'unavailable spike', 'timeout spike', 'sanitization or authorization failure spike'],
  auditFailure: 'a failed audit write must not expose request data; the operation is not considered proven without the required audit path',
});

export const IMPLEMENTATION_PLAN = deepFreeze([
  { id: 'architecture', title: 'Canonical architecture v1', status: 'merged #1310; runtime-free manifest', acceptance: ['ADR and manifest agree', 'boundaries and non-goals are explicit', 'no runtime or migration change'] },
  { id: 'M0', title: 'Normalized contracts', status: 'merged #1303', acceptance: ['pure versioned evidence, provenance, coverage, signal, and score envelopes'] },
  { id: 'M1', title: 'Creator registry and additive PostgreSQL artifact', status: 'merged #1304; staging-only governed runner source added; artifact unapplied pending terminal staging evidence', acceptance: ['minimal pseudonymous registry', 'additive/idempotent SQL', 'destination and grant gates before apply'] },
  { id: 'M2', title: 'Official-first provider router and bounded collectors', status: 'canonical router merged #1324 (supersedes #1305); transport gate source implemented, staging credential/deployment pending', acceptance: ['Meta first', 'controlled instagrapi fallback', 'fail-closed classification', 'no duplicate scraper'] },
  { id: 'M3', title: 'Append-only snapshots, retention, and Orb job contract', status: 'data model #1322, snapshots #1331, scheduler #1335, and disabled service binding merged; workflow import remains pending', acceptance: ['new additive tables', 'immutable evidence lifecycle', 'bounded snapshot_creator and snapshot_creator_media operations', 'inactive dry-run/shadow scheduling', 'resume/recovery with idempotent service calls', 'no live workflow import'] },
  { id: 'M4', title: 'Robust analytics', status: 'merged #1333; synthetic source/tests only', acceptance: ['time windows', 'viral-outlier resistance', 'explicit unavailable coverage'] },
  { id: 'M5', title: 'Deterministic scores and confidence', status: 'merged #1334; synthetic source/tests only', acceptance: ['versioned algorithms', 'score/confidence/coverage/provenance completeness', 'calibration fixtures'] },
  { id: 'M6', title: 'Hardened read-only MCP', status: 'source adapter, protocol tests, and disabled loopback runtime registration implemented', acceptance: ['auth', 'sanitization', 'rate limit', 'timeout', 'audit', 'bounded tools', 'read-only role'] },
  { id: 'M7', title: 'Codex skill', status: 'versioned skill and contract tests implemented; MCP/runtime registration remains governed by later gates', acceptance: ['read-only tool use', 'safe question routing', 'no provider or shell bypass'] },
  { id: 'M8', title: 'CRM read-only surface', status: 'internal proxy, signed upstream registration, typed client, gated shadow dashboard, and synthetic UI tests implemented; runtime remains off', acceptance: ['internal API only', 'server grant and flag', 'shadow UI', 'no direct provider access'] },
  { id: 'M9', title: 'Comments intelligence', status: 'source implemented; aggregate-only analyzer, additive persistence metadata, and synthetic tests; runtime/provider wiring remains off', acceptance: ['aggregate-only signals', 'privacy and model provenance', 'bounded retention'] },
  { id: 'M10', title: 'Semantic content and Reels signals', status: 'source implemented; bounded feature projection and closed semantic interface; runtime/media adapter remains off', acceptance: ['approved media projection', 'no raw media archive by default', 'versioned inference'] },
  { id: 'M11', title: 'Campaign and brand fit', status: 'source implemented; deterministic engine, additive persistence metadata, read-only MCP projection, CRM query surface, and golden tests; compute/runtime remains off', acceptance: ['structured criteria', 'explainable deterministic base', 'inferred signals labeled', 'separate campaign-fit confidence and coverage', 'persisted fit read has no implicit computation'] },
  { id: 'M12', title: 'Synthetic validation and calibration', status: 'source implemented; deterministic synthetic report and focused tests; no live provider or runtime calls', acceptance: ['fixtures', 'outlier tests', 'coverage/confidence calibration', 'negative policy tests'] },
  { id: 'M13', title: 'Optional provider gap analysis', status: 'source implemented; source-level gap matrix/ADR; live coverage decision pending runtime evidence; no external provider integrated', acceptance: ['source-level gap report', 'cost/risk/privacy review', 'live coverage evidence before provider selection', 'new provider only after explicit configuration, allowlisting, and approval'] },
  { id: 'runtime-registration', title: 'Internal runtime registration', status: 'service, MCP, signed CRM upstream, and inactive Orb source registered; flag/grant, Token Vault deployment, workflow import, and provider calls remain off', acceptance: ['loopback internal service binding', 'MCP delegates through service', 'CRM signature includes fixed grant', 'Orb workflow source carries private service auth', 'units install disabled', 'rollback and staging validation documented'] },
]);

export const ARCHITECTURE_MANIFEST = deepFreeze({
  version: INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION,
  domainRoot: DOMAIN_ROOT,
  featureAccess: FEATURE_ACCESS,
  boundaries: BOUNDARIES,
  providerInterface: PROVIDER_INTERFACE,
  dataModel: DATA_MODEL,
  provenance: PROVENANCE_CONTRACT,
  score: SCORE_CONTRACT,
  api: API_CONTRACT,
  mcp: MCP_CONTRACT,
  release: RELEASE_CONTRACT,
  privacy: PRIVACY_CONTRACT,
  observability: OBSERVABILITY_CONTRACT,
  implementationPlan: IMPLEMENTATION_PLAN,
});
