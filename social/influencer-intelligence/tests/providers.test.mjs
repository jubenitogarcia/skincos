import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createInstagrapiProvider,
  INSTAGRAPI_PROFILE_FIELDS,
} from '../providers/instagrapi-adapter.mjs';
import {
  createMetaGraphProvider,
  META_GRAPH_PROFILE_FIELDS,
} from '../providers/meta-graph-adapter.mjs';
import {
  ProviderCollectionError,
  ProviderGapError,
} from '../providers/profile-provider.mjs';
import {
  createProviderRouter,
  ProviderRouterError,
} from '../provider-router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const observedAt = '2026-08-10T14:00:00.000Z';
const retrievedAt = '2026-08-10T14:00:02.000Z';
const collectionInput = {
  creatorKey: 'creator:synthetic-001',
  handle: '@Synthetic.Creator',
  observedAt,
  retrievedAt,
};

test('official Meta adapter uses a read-only injected transport and normalized projection', async () => {
  const calls = [];
  const provider = createMetaGraphProvider({
    readProfile: async (request) => {
      calls.push(request);
      return {
        handle: 'Synthetic.Creator',
        followersCount: 12000,
        mediaCount: 42,
      };
    },
  });

  const snapshot = await provider.collect(collectionInput);
  assert.equal(provider.id, 'meta-graph');
  assert.equal(provider.officialFirst, true);
  assert.deepEqual(calls, [{
    handle: 'synthetic.creator',
    fields: META_GRAPH_PROFILE_FIELDS,
    mode: 'read-only',
  }]);
  assert.equal(snapshot.provider, 'meta-graph');
  assert.deepEqual(snapshot.observations.map(({ key, value, evidenceState }) => ({
    key,
    value,
    evidenceState,
  })), [
    { key: 'followers_count', value: 12000, evidenceState: 'observed' },
    { key: 'media_count', value: 42, evidenceState: 'observed' },
  ]);
  assert.equal('profile' in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('instagrapi adapter is a controlled fallback and keeps unavailable metrics explicit', async () => {
  const calls = [];
  const provider = createInstagrapiProvider({
    readProfile: async (request) => {
      calls.push(request);
      return {
        handle: 'Synthetic.Creator',
        followersCount: null,
        mediaCount: 7,
      };
    },
  });

  const snapshot = await provider.collect(collectionInput);
  assert.equal(provider.id, 'instagrapi');
  assert.equal(provider.officialFirst, false);
  assert.deepEqual(calls[0].fields, INSTAGRAPI_PROFILE_FIELDS);
  assert.deepEqual(snapshot.observations.map(({ key, value, evidenceState }) => ({
    key,
    value,
    evidenceState,
  })), [
    { key: 'followers_count', value: null, evidenceState: 'unavailable' },
    { key: 'media_count', value: 7, evidenceState: 'observed' },
  ]);
});

test('adapter rejects sensitive or raw provider fields before the contract boundary', async () => {
  const provider = createMetaGraphProvider({
    readProfile: async () => ({
      handle: 'synthetic.creator',
      followersCount: 10,
      access_token: 'never-retained',
    }),
  });

  await assert.rejects(
    provider.collect(collectionInput),
    (error) => error instanceof ProviderCollectionError && error.reasonCode === 'policy_block',
  );
});

test('router tries Meta first and falls back only for an explicit coverage gap', async () => {
  const calls = [];
  const meta = createMetaGraphProvider({
    readProfile: async () => {
      calls.push('meta-graph');
      throw new ProviderGapError('coverage_gap');
    },
  });
  const instagrapi = createInstagrapiProvider({
    readProfile: async () => {
      calls.push('instagrapi');
      return { handle: 'synthetic.creator', followersCount: 90, mediaCount: 4 };
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta, instagrapi },
  });

  const result = await router.collect(collectionInput);
  assert.deepEqual(calls, ['meta-graph', 'instagrapi']);
  assert.equal(result.status, 'collected');
  assert.equal(result.provider, 'instagrapi');
  assert.deepEqual(result.attempts, [
    { provider: 'meta-graph', status: 'gap', reasonCode: 'coverage_gap' },
    { provider: 'instagrapi', status: 'collected' },
  ]);
  assert.equal('message' in result.attempts[0], false);
});

test('router fails closed and does not fall back on policy or invalid-response failures', async () => {
  let fallbackCalls = 0;
  const meta = createMetaGraphProvider({
    readProfile: async () => {
      throw new ProviderCollectionError('policy_block');
    },
  });
  const instagrapi = createInstagrapiProvider({
    readProfile: async () => {
      fallbackCalls += 1;
      return { handle: 'synthetic.creator', followersCount: 1, mediaCount: 1 };
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta, instagrapi },
  });

  await assert.rejects(
    router.collect(collectionInput),
    (error) => error instanceof ProviderRouterError
      && error.reasonCode === 'policy_block'
      && error.provider === 'meta-graph',
  );
  assert.equal(fallbackCalls, 0);
});

test('router reports unavailable only after every configured provider returns an allowed gap', async () => {
  const meta = createMetaGraphProvider({
    readProfile: async () => {
      throw new ProviderGapError('provider_unavailable');
    },
  });
  const instagrapi = createInstagrapiProvider({
    readProfile: async () => {
      throw new ProviderGapError('permission_gap');
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta, instagrapi },
  });

  const result = await router.collect(collectionInput);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.attempts, [
    { provider: 'meta-graph', status: 'gap', reasonCode: 'provider_unavailable' },
    { provider: 'instagrapi', status: 'gap', reasonCode: 'permission_gap' },
  ]);
});

test('router enforces an official-first allowlist and providers expose no write surface', () => {
  const meta = createMetaGraphProvider({ readProfile: async () => ({}) });
  const instagrapi = createInstagrapiProvider({ readProfile: async () => ({}) });
  assert.throws(() => createProviderRouter({
    providers: { 'meta-graph': meta, instagrapi },
    providerOrder: ['instagrapi', 'meta-graph'],
  }), (error) => error instanceof ProviderRouterError && error.reasonCode === 'official_first_required');
  assert.throws(() => createProviderRouter({
    providers: { 'meta-graph': meta },
    providerOrder: ['future-provider'],
  }), (error) => error instanceof ProviderRouterError && error.reasonCode === 'unknown_provider');
  assert.deepEqual(Object.keys(meta).sort(), ['capabilities', 'collect', 'id', 'officialFirst']);
  assert.deepEqual(Object.keys(instagrapi).sort(), ['capabilities', 'collect', 'id', 'officialFirst']);
});

test('provider implementation has no network, session, scraper, or simulator dependency', () => {
  const providerFiles = [
    '../provider-router.mjs',
    '../providers/profile-provider.mjs',
    '../providers/meta-graph-adapter.mjs',
    '../providers/instagrapi-adapter.mjs',
  ].map((relativePath) => fs.readFileSync(path.join(here, relativePath), 'utf8')).join('\n');
  assert.doesNotMatch(providerFiles, /\bfetch\s*\(/i);
  assert.doesNotMatch(providerFiles, /from\s+['"]node:(?:http|https|net|tls)['"]/i);
  assert.doesNotMatch(providerFiles, /InstagramModuleSimulator|instaloader/i);
});
