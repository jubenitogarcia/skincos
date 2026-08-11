import { createProfileProvider } from './profile-provider.mjs';

// The injected transport must already map the official Graph response into the
// small projection accepted by the provider boundary. This keeps credentials,
// raw profile payloads, and HTTP concerns outside Influencer Intelligence.
export const META_GRAPH_PROFILE_FIELDS = Object.freeze([
  'username',
  'followers_count',
  'media_count',
]);

export function createMetaGraphProvider(options = {}) {
  return createProfileProvider({
    provider: 'meta-graph',
    officialFirst: true,
    sourceRefPrefix: 'meta-graph',
    requestFields: META_GRAPH_PROFILE_FIELDS,
    readProfile: options.readProfile,
  });
}
