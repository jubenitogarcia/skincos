/**
 * Versioned, runtime-free architecture contract for Influencer Intelligence.
 *
 * This file describes boundaries and future interfaces only. It deliberately
 * does not register routes, providers, jobs, migrations, grants, or secrets.
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
    owns: ['normalized evidence contracts', 'creator registry', 'append-only snapshots', 'analytics', 'scores', 'campaign-fit projections', 'provenance'],
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
    futureRequirement: 'A separate read-only analytics action and allowlist must be reviewed before a provider transport is connected.',
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
    owner: 'orb/engine/mcp-readonly-gateway pattern',
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
    owner: 'orb/engine',
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
    { name: 'get_profile', readOnly: true, lifecycle: 'bounded profile projection; synthetic transport only until a later gate' },
    { name: 'get_recent_media', readOnly: true, lifecycle: 'bounded media identity projection; no binary archive' },
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
    additiveMigrations: ['migrations/20260812_influencer_intelligence_comments_v1.up.sql'],
    dependsOn: 'migrations/20260810_influencer_intelligence_registry_v1.up.sql',
    artifactStatus: 'source-controlled additive artifacts; not applied by this milestone',
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
      { name: 'campaign_creator_fit', concept: 'campaign fit', lifecycle: 'append-only derived creator/campaign projection' },
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
  exposure: 'internal authenticated service contract; not implemented or publicly mounted by the architecture PR',
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
      purpose: 'Return a versioned analysis envelope for one creator.',
    },
    {
      method: 'GET',
      path: '/internal/influencer-intelligence/v1/creators/{creatorKey}/coverage',
      readOnly: true,
      purpose: 'Return data availability and provenance coverage without provider payloads.',
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
      purpose: 'Compute a bounded campaign-fit projection from structured criteria; no campaign is created or dispatched.',
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
  contractVersion: 'influencer-intelligence/mcp/v1',
  transport: 'domain adapter for the authenticated orb/engine/mcp-readonly-gateway pattern; MCP is not a provider transport',
  controls: ['authentication', 'server-side grant', 'schema sanitization', 'bounded input', 'rate limit', 'timeout and abort', 'audit event', 'read-only database role', 'redacted output'],
  limits: { maxRequestBytes: 65536, maxResponseBytes: 524288, maxPageSize: 50, maxCreatorsPerRequest: 20, maxWindowDays: 365, maxConcurrentRequests: 4, timeoutMs: 12000, rateLimitPerMinute: 60 },
  tools: [
    { name: 'search_creators', readOnly: true, input: ['query', 'provider', 'registry_state', 'page', 'page_size'] },
    { name: 'get_creator_profile', readOnly: true, input: ['creator_key'] },
    { name: 'get_creator_snapshots', readOnly: true, input: ['creator_key', 'window', 'page', 'page_size'] },
    { name: 'get_creator_media', readOnly: true, input: ['creator_key', 'window', 'page', 'page_size'] },
    { name: 'get_creator_analytics', readOnly: true, input: ['creator_key', 'window'] },
    { name: 'get_creator_score', readOnly: true, input: ['creator_key'] },
    { name: 'compare_creators', readOnly: true, input: ['creator_keys', 'window'] },
  ],
  deferredTools: [{ name: 'get_campaign_fit', unavailableUntil: 'M11', rule: 'not registered before Campaign Fit exists' }],
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
    schedulerSourceAdded: true,
    schedulerWorkflowImported: false,
    schedulerWorkflowActive: false,
    schedulerMigrationArtifactAdded: true,
    mcpSourceAdded: true,
    mcpRuntimeRegistered: false,
    crmSourceAdded: true,
    crmRuntimeEnabled: false,
    crmUpstreamConfigured: false,
    crmFeatureFlagDefault: false,
    commentsSourceAdded: true,
    commentsMigrationArtifactAdded: true,
    commentsRuntimeWired: false,
  },
});

export const PRIVACY_CONTRACT = deepFreeze({
  retained: ['opaque creator key', 'optional normalized public handle', 'scalar metric observations', 'aggregate comments signals', 'provider account digest', 'bounded provenance and audit metadata'],
  neverPersisted: ['raw provider account identity', 'raw profile payload', 'direct contact fields', 'credential material', 'cookies or sessions', 'raw comment text by default', 'raw media or binaries', 'unbounded model prompts or completions', 'simulator output as observed evidence'],
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
  { id: 'M1', title: 'Creator registry and additive PostgreSQL artifact', status: 'merged #1304; registry artifact unapplied', acceptance: ['minimal pseudonymous registry', 'additive/idempotent SQL', 'destination and grant gates before apply'] },
  { id: 'M2', title: 'Official-first provider router and bounded collectors', status: 'canonical router merged #1324 (supersedes #1305); synthetic transport only', acceptance: ['Meta first', 'controlled instagrapi fallback', 'fail-closed classification', 'no duplicate scraper'] },
  { id: 'M3', title: 'Append-only snapshots, retention, and Orb job contract', status: 'data model #1322, snapshots #1331, and scheduler #1335 merged; artifacts/import/runtime pending', acceptance: ['new additive tables', 'immutable evidence lifecycle', 'bounded snapshot_creator and snapshot_creator_media operations', 'inactive dry-run/shadow scheduling', 'resume/recovery with idempotent service calls', 'no live workflow import'] },
  { id: 'M4', title: 'Robust analytics', status: 'merged #1333; synthetic source/tests only', acceptance: ['time windows', 'viral-outlier resistance', 'explicit unavailable coverage'] },
  { id: 'M5', title: 'Deterministic scores and confidence', status: 'merged #1334; synthetic source/tests only', acceptance: ['versioned algorithms', 'score/confidence/coverage/provenance completeness', 'calibration fixtures'] },
  { id: 'M6', title: 'Hardened read-only MCP', status: 'source adapter and protocol tests implemented; runtime registration pending', acceptance: ['auth', 'sanitization', 'rate limit', 'timeout', 'audit', 'bounded tools', 'read-only role'] },
  { id: 'M7', title: 'Codex skill', status: 'versioned skill and contract tests implemented; MCP/runtime registration remains governed by later gates', acceptance: ['read-only tool use', 'safe question routing', 'no provider or shell bypass'] },
  { id: 'M8', title: 'CRM read-only surface', status: 'internal proxy, typed client, gated shadow dashboard, and synthetic UI tests implemented; upstream/runtime remains off', acceptance: ['internal API only', 'server grant and flag', 'shadow UI', 'no direct provider access'] },
  { id: 'M9', title: 'Comments intelligence', status: 'source implemented; aggregate-only analyzer, additive persistence metadata, and synthetic tests; runtime/provider wiring remains off', acceptance: ['aggregate-only signals', 'privacy and model provenance', 'bounded retention'] },
  { id: 'M10', title: 'Semantic content and Reels signals', status: 'pending', acceptance: ['approved media projection', 'no raw media archive by default', 'versioned inference'] },
  { id: 'M11', title: 'Campaign and brand fit', status: 'pending', acceptance: ['structured criteria', 'explainable deterministic base', 'inferred signals labeled'] },
  { id: 'M12', title: 'Synthetic validation and calibration', status: 'pending', acceptance: ['fixtures', 'outlier tests', 'coverage/confidence calibration', 'negative policy tests'] },
  { id: 'M13', title: 'Optional provider gap analysis', status: 'pending', acceptance: ['measured gap report', 'cost/risk/privacy review', 'new provider only after approval'] },
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
