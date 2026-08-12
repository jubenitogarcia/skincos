export type ProviderOperation =
  | 'resolve_creator'
  | 'get_profile'
  | 'get_recent_media'
  | 'get_media_metrics'
  | 'get_comments_sample'
  | 'get_profile_metrics';

export type DataClassification = 'observed' | 'derived' | 'inferred';
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';
export type ProviderResultStatus = 'ok' | 'unavailable';

export interface ProviderWindow {
  start: string;
  end: string;
}

export interface ProviderRequest {
  operation: ProviderOperation;
  creator_key?: string;
  canonical_handle?: string;
  observed_at: string;
  retrieved_at: string;
  correlation_id: string;
  window?: ProviderWindow;
  limit: number;
  media_keys?: readonly string[];
  metric_set?: readonly string[];
  requested_fields?: readonly string[];
}

export interface ProviderFreshness {
  status: FreshnessStatus;
  observed_at: string | null;
  retrieved_at: string;
  age_seconds: number | null;
  max_age_seconds: number;
}

export interface ProviderSpecificEvidence {
  provider: string;
  operation: ProviderOperation;
  adapter_version: string;
  source_ref: string;
  correlation_id: string;
  fields?: readonly string[];
  endpoint_family?: string;
  coverage_code?: string;
  model_version?: string;
}

export interface ProviderAttempt {
  provider: string;
  operation: ProviderOperation;
  status: 'ok' | 'gap' | 'blocked' | 'skipped';
  classification?: string;
  retry_count: number;
}

export interface ProviderResult<TData = unknown> {
  contract_version: string;
  operation: ProviderOperation;
  status: ProviderResultStatus;
  provider: string | null;
  retrieved_at: string;
  data_classification: DataClassification;
  freshness: ProviderFreshness;
  limitations: readonly string[];
  provider_specific_evidence: ProviderSpecificEvidence;
  data: TData | null;
  attempts?: readonly ProviderAttempt[];
}

export interface ProviderCallContext {
  signal: AbortSignal;
  attempt: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly officialFirst: boolean;
  readonly capabilities: readonly ProviderOperation[];
  resolve_creator(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
  get_profile(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
  get_recent_media(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
  get_media_metrics(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
  get_comments_sample(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
  get_profile_metrics(request: ProviderRequest, context: ProviderCallContext): Promise<ProviderResult>;
}
