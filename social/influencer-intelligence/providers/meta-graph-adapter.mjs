import { createOperationProvider } from './operation-provider.mjs';

// The injected transport must already map the official Graph response into the
// small projection accepted by the provider boundary. This keeps credentials,
// raw profile payloads, and HTTP concerns outside Influencer Intelligence.
export const META_GRAPH_PROFILE_FIELDS = Object.freeze([
  'username',
  'followers_count',
  'media_count',
]);

export const META_GRAPH_OPERATION_FIELDS = Object.freeze({
  resolve_creator: Object.freeze(['username']),
  get_profile: META_GRAPH_PROFILE_FIELDS,
  get_recent_media: Object.freeze(['id', 'media_type', 'timestamp']),
  get_media_metrics: Object.freeze(['id', 'like_count', 'comments_count', 'views']),
  get_comments_sample: Object.freeze(['comments']),
  get_profile_metrics: Object.freeze(['followers_count', 'media_count', 'insights']),
});

export function createMetaGraphProvider(options = {}) {
  return createOperationProvider({
    provider: 'meta-graph',
    officialFirst: true,
    sourceRefPrefix: 'meta-graph',
    fieldsByOperation: options.fieldsByOperation || META_GRAPH_OPERATION_FIELDS,
    operations: options.operations,
    readProfile: options.readProfile,
    readProfileMetrics: options.readProfileMetrics,
    resolveCreator: options.resolveCreator,
    adapterVersion: options.adapterVersion || 'meta-graph-adapter-v1',
  });
}
