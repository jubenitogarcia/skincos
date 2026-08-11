import { createOperationProvider } from './operation-provider.mjs';

// This is a narrow wrapper around the existing social/instagram read path. It
// does not own sessions, credentials, scraping, downloads, or engagement APIs.
export const INSTAGRAPI_PROFILE_FIELDS = Object.freeze([
  'username',
  'follower_count',
  'media_count',
]);

export const INSTAGRAPI_OPERATION_FIELDS = Object.freeze({
  resolve_creator: Object.freeze(['username']),
  get_profile: INSTAGRAPI_PROFILE_FIELDS,
  get_recent_media: Object.freeze(['pk', 'media_type', 'taken_at']),
  get_media_metrics: Object.freeze(['pk', 'like_count', 'comment_count', 'view_count']),
  get_comments_sample: Object.freeze(['comments']),
  get_profile_metrics: Object.freeze(['follower_count', 'media_count', 'insights']),
});

export function createInstagrapiProvider(options = {}) {
  return createOperationProvider({
    provider: 'instagrapi',
    officialFirst: false,
    sourceRefPrefix: 'instagrapi',
    fieldsByOperation: options.fieldsByOperation || INSTAGRAPI_OPERATION_FIELDS,
    operations: options.operations,
    readProfile: options.readProfile,
    readProfileMetrics: options.readProfileMetrics,
    resolveCreator: options.resolveCreator,
    adapterVersion: options.adapterVersion || 'instagrapi-adapter-v1',
  });
}
