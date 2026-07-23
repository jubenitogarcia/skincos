import assert from 'node:assert/strict';
import test from 'node:test';
import { __test } from '../src/meta-ads-publish.js';

test('builds the official graph-video upload endpoint', () => {
  assert.equal(
    __test.graphVideoUrl('v25.0', 'act_3271664739829465/advideos'),
    'https://graph-video.facebook.com/v25.0/act_3271664739829465/advideos',
  );
  assert.throws(() => __test.graphVideoUrl('v25.0', 'act_1/advideos?access_token=leak'), /invalid_graph_video_path/);
});

test('enforces the normalized video and chunk protocol limits', () => {
  assert.equal(__test.normalizeVideoFileSize(90 * 1024 * 1024), 90 * 1024 * 1024);
  assert.throws(() => __test.normalizeVideoFileSize(90 * 1024 * 1024 + 1), /video_size_invalid/);
  assert.equal(__test.normalizeVideoOffset('16777216', 'start_offset'), 16 * 1024 * 1024);
  assert.throws(() => __test.normalizeVideoOffset('-1', 'start_offset'), /start_offset_invalid/);
});

test('validates start transfer and finish responses before journaling them', () => {
  const start = __test.normalizeVideoUploadResponse({
    upload_session_id: '123456789012345',
    video_id: '987654321012345',
    start_offset: '0',
    end_offset: '16777216',
  }, 'start');
  assert.equal(start.video_id, '987654321012345');

  const transfer = __test.normalizeVideoUploadResponse({
    start_offset: '16777216',
    end_offset: '33554432',
  }, 'transfer');
  assert.equal(transfer.start_offset, '16777216');

  assert.deepEqual(__test.normalizeVideoUploadResponse({ success: true }, 'finish'), { success: true });
  assert.throws(() => __test.normalizeVideoUploadResponse({ success: false }, 'finish'), /video_finish_not_confirmed/);
});

test('rejects malformed upload sessions and impossible returned offsets', () => {
  assert.equal(__test.normalizeUploadSessionId('1234567890'), '1234567890');
  assert.throws(() => __test.normalizeUploadSessionId('session-secret'), /upload_session_id_invalid/);
  assert.throws(() => __test.normalizeVideoUploadResponse({
    upload_session_id: '1234567890',
    video_id: '9876543210',
    start_offset: '0',
    end_offset: String(90 * 1024 * 1024 + 1),
  }, 'start'), /end_offset_invalid/);
});

test('allows archiving only as an explicit batch operation', () => {
  assert.equal(__test.allowedActions.has('archive_batch'), true);
  assert.equal(__test.allowedActions.has('delete_ad'), false);
});

test('stage batch forces the commercial publish payload active', () => {
  // stageBatch is integration-heavy because it owns journal writes and Graph
  // reconciliation. Assert the deployed source-level invariant here so a
  // future change cannot reintroduce the PAUSED override unnoticed.
  assert.match(__test.stageBatch.toString(), /payload\.status = "ACTIVE"/);
  assert.doesNotMatch(__test.stageBatch.toString(), /payload\.status = "PAUSED"/);
});

test('blocks a mixed image and video asset feed before Meta rejects it', () => {
  const features = Object.fromEntries([
    'add_text_overlay', 'image_touchups', 'text_optimizations', 'inline_comment', 'enhance_cta',
    'image_brightness_and_contrast', 'reveal_details_over_time', 'show_destination_blurbs', 'image_animation',
  ].map((name) => [name, { enroll_status: 'OPT_IN' }]));
  const bodyLabels = [{ name: 'body' }];
  const titleLabels = [{ name: 'title' }];
  const payload = {
    name: 'Mixed fixture',
    object_story_spec: { page_id: '1234567890' },
    asset_feed_spec: {
      ad_formats: ['SINGLE_IMAGE'],
      images: [
        { hash: 'a'.repeat(32), adlabels: [{ name: 'feed_image' }] },
        { hash: 'b'.repeat(32), adlabels: [{ name: 'banner_image' }] },
        { hash: 'c'.repeat(32), adlabels: [{ name: 'vertical_image' }] },
      ],
      videos: [{ video_id: '987654321012345', thumbnail_hash: 'd'.repeat(32), adlabels: [{ name: 'vertical_video' }] }],
      bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}`, adlabels: bodyLabels })),
      titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}`, adlabels: titleLabels })),
      descriptions: [{ text: 'description' }],
      call_to_action_types: ['WHATSAPP_MESSAGE'],
      link_urls: [{ website_url: 'https://wa.me/5551999999999' }],
      asset_customization_rules: [
        { image_label: { name: 'feed_image' }, body_label: bodyLabels[0], title_label: titleLabels[0], customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed'], instagram_positions: ['stream'] } },
        { image_label: { name: 'banner_image' }, body_label: bodyLabels[0], title_label: titleLabels[0], customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] } },
        { image_label: { name: 'vertical_image' }, video_label: { name: 'vertical_video' }, body_label: bodyLabels[0], title_label: titleLabels[0], customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['story', 'facebook_reels'], instagram_positions: ['story', 'reels'] } },
        { image_label: { name: 'vertical_image' }, body_label: bodyLabels[0], title_label: titleLabels[0], customization_spec: { publisher_platforms: ['audience_network', 'whatsapp'] } },
      ],
    },
    degrees_of_freedom_spec: { creative_features_spec: features },
    creative_sourcing_spec: {},
  };
  assert.throws(
    () => __test.validateCreativePayload(payload, 'creative:mixed:fixture'),
    /mixed_image_video_single_creative_unsupported_by_meta/,
  );
});

test('accepts a video-only creative through object_story_spec.video_data', () => {
  const payload = {
    name: 'Video fixture',
    object_story_spec: {
      page_id: '1234567890',
      video_data: {
        video_id: '987654321012345',
        image_hash: 'a'.repeat(32),
        message: 'Mensagem',
        title: 'Titulo',
        call_to_action: { type: 'LEARN_MORE', value: { link: 'https://espacofacial.com/agendamento?unit=novo-hamburgo' } },
      },
    },
  };
  const result = __test.validateCreativePayload(payload, 'creative:video:fixture');
  assert.equal(result.object_story_spec.video_data.video_id, '987654321012345');
  assert.equal(result.asset_feed_spec, undefined);
});
