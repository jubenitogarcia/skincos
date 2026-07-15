import assert from 'node:assert/strict';
import test from 'node:test';

import { isLinkPreviewEnabled } from './linkPreviewPolicy';

test('link previews remain disabled until the operator enables the fetch capability', () => {
  assert.equal(isLinkPreviewEnabled(undefined, {}), false);
  assert.equal(isLinkPreviewEnabled(true, {}), false);
  assert.equal(isLinkPreviewEnabled(false, {}), false);
});

test('the operator can restore the established behavior while callers may still opt out', () => {
  const enabled = { ENABLE_LINK_PREVIEW_FETCH: 'true' };
  assert.equal(isLinkPreviewEnabled(undefined, enabled), true);
  assert.equal(isLinkPreviewEnabled(true, enabled), true);
  assert.equal(isLinkPreviewEnabled(false, enabled), false);
  assert.equal(isLinkPreviewEnabled('true', enabled), false);
});
