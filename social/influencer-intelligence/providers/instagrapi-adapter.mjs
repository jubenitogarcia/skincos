import { createProfileProvider } from './profile-provider.mjs';

// This is a narrow wrapper around the existing social/instagram read path. It
// does not own sessions, credentials, scraping, downloads, or engagement APIs.
export const INSTAGRAPI_PROFILE_FIELDS = Object.freeze([
  'username',
  'follower_count',
  'media_count',
]);

export function createInstagrapiProvider(options = {}) {
  return createProfileProvider({
    provider: 'instagrapi',
    officialFirst: false,
    sourceRefPrefix: 'instagrapi',
    requestFields: INSTAGRAPI_PROFILE_FIELDS,
    readProfile: options.readProfile,
  });
}
