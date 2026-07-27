'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');

function runCode(sourceName, input, items = {}) {
  const source = fs.readFileSync(path.join(sourceRoot, sourceName), 'utf8');
  return vm.runInNewContext(`(function () {\n${source}\n})()`, {
    $input: { all: () => input, first: () => input[0] },
    $items: (name) => items[name] || [],
    $execution: { id: 1 },
    console,
    Date,
    JSON,
    Map,
    Set,
    BigInt,
    RegExp,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Math,
  }, { filename: sourceName, timeout: 1000 });
}

function offerFingerprint() {
  return {
    confidence: 0.9,
    procedures: [{ key: 'botox', quantity: '40', unit: 'ui' }],
    price_amount_cents: 99900,
    price_qualifier: 'fixed',
    payment_terms: [],
    condition_terms: [],
    validity: '',
    evidence: ['Botox 40 UI por R$ 999'],
  };
}

test('validates five ordered static images as one carousel group', () => {
  const media = Array.from({ length: 5 }, (_, index) => ({
    media_ref: `IMG_${String(index + 1).padStart(3, '0')}`,
    media_type: 'image',
    source_item_index: index,
    source_file_id: `drive-${index + 1}`,
  }));
  const original = media.map((entry, index) => ({
    json: { id: entry.source_file_id, name: `random-${index + 1}.jpg` },
    binary: { data: { mimeType: 'image/jpeg', fileName: `random-${index + 1}.jpg` } },
  }));
  const output = runCode('validate-visual-grouping.js', [{
    json: {
      output: JSON.stringify({
        groups: [{
          group_key: 'VISUAL_GROUP_01', media_mode: 'carousel', confidence: 0.95,
          visual_concept: 'Sequencia de botox', evidence: ['mesma oferta e narrativa'],
          offer_fingerprint: offerFingerprint(),
        }],
        assignments: media.map((entry, index) => ({
          media_ref: entry.media_ref, media_type: 'image', group_key: 'VISUAL_GROUP_01',
          ratio: '1x1', role: 'carousel_card', carousel_card_index: index + 1,
          confidence: 0.95, evidence: ['oferta e composicao compativeis'],
        })),
      }),
    },
  }], {
    'Prepare Visual Grouping Batch': [{ json: { visual_grouping_batch_version: '3', media } }],
    'Prepare Media Inventory': original,
  });

  assert.equal(output.length, 5);
  assert.deepEqual(Array.from(output, (item) => item.json.visual_grouping.carousel_card_index), [1, 2, 3, 4, 5]);
  assert(output.every((item) => item.json.visual_grouping.media_mode === 'carousel'));
});

test('infers carousel card roles only after visual membership when v3 mode is omitted', () => {
  const media = Array.from({ length: 5 }, (_, index) => ({
    media_ref: `IMG_${String(index + 1).padStart(3, '0')}`,
    media_type: 'image', source_item_index: index, source_file_id: `drive-${index + 1}`, ordinal: index + 1,
  }));
  const original = media.map((entry, index) => ({
    json: { id: entry.source_file_id }, binary: { data: { mimeType: 'image/jpeg' } },
  }));
  const output = runCode('validate-visual-grouping.js', [{
    json: { output: JSON.stringify({
      groups: [{ group_key: 'VISUAL_GROUP_01', confidence: 0.95, visual_concept: 'Sequencia', evidence: ['mesma narrativa'], offer_fingerprint: offerFingerprint() }],
      assignments: media.map((entry) => ({
        media_ref: entry.media_ref, media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '4x5', role: 'feed_image',
        confidence: 0.95, evidence: ['mesma oferta e sequencia'],
      })),
    }) },
  }], {
    'Prepare Visual Grouping Batch': [{ json: { visual_grouping_batch_version: '3', media } }],
    'Prepare Media Inventory': original,
  });
  assert.deepEqual(Array.from(output, (item) => item.json.visual_grouping.role), Array(5).fill('carousel_card'));
  assert.deepEqual(Array.from(output, (item) => item.json.visual_grouping.carousel_card_index), [1, 2, 3, 4, 5]);
  assert(output.every((item) => item.json.visual_grouping.carousel_card_order_source === 'intake_sequence_fallback_after_visual_membership'));
});

test('carousel upload plan requires every ordered image for every destination account', () => {
  const output = runCode('prepare-media-upload-plan.js', [{
    json: {
      job_key: 'job-1', group_key: 'VISUAL_GROUP_01', media_mode: 'carousel',
      imagens: Array.from({ length: 5 }, (_, index) => ({ id: `drive-${index + 1}` })), videos: [],
      destinations: [{ destination_ad_account_id: '111' }, { destination_ad_account_id: '222' }],
    },
    binary: {},
  }]);
  assert.equal(output[0].json.media_upload_plan.expected.images, 10);
  assert.equal(output[0].json.media_upload_plan.expected.videos, 0);
});

test('Build Jobs rehydrates carousel card ordinals from a gateway receipt filename', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  assert.match(source, /const mappedRef = fileToJob\.get\(normalizedFilename\)/);
  assert.match(source, /upload_key: safeString\(media\.role\) === 'carousel_card'/);
  assert.match(source, /target\[targetKey\] = \{/);
  assert.match(source, /function isCurrentCarouselResumeContract\(row\)/);
  assert.match(source, /formats\[0\] !== 'CAROUSEL'/);
  assert.match(source, /const ctaTypes = safeArray\(feed\.call_to_action_types\)/);
});

test('accepts one five-card flexible carousel creative', () => {
  const link = 'https://espacofacial.com/agendamento?unit=barrashoppingsul';
  const label = (kind, index) => ({ name: `${kind}_${index}` });
  const card = (index) => ({
    image_label: label('image', index), body_label: label('body', index), title_label: label('title', index),
    description_label: label('description', index), link_url_label: label('link', index), call_to_action_type_label: label('cta', 1),
  });
  const output = runCode('validate-meta-creative-payload.js', [{
    json: {
      run_id: 'run-1', batch_fingerprint: 'batch-1', workflow_contract_revision: 'meta_destination_contract_v10_carousel',
      token_id: 'opaque', api_version: 'v25.0', account_id: '123', page_id: '456', action: 'create_new',
      media_variant: 'carousel', destination_contract: { kind: 'website' }, allowed_link_hosts: [],
      landing_page_url: link, scheduling_landing_page_url: link,
      offer_fingerprint: { replacement_eligible: false, status: 'unverified', tag: '' },
      offer_replacement_guard: { reason: 'offer_fingerprint_unverified' },
      asset_ids: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`carousel_card_${index + 1}`, `drive-${index + 1}`])),
      creativePayload: {
        name: 'Carousel test',
        object_story_spec: { page_id: '456' },
        asset_feed_spec: {
          ad_formats: ['CAROUSEL'], optimization_type: 'PLACEMENT',
          images: Array.from({ length: 5 }, (_, index) => ({ hash: `hash-${index + 1}`, adlabels: [label('image', index + 1)] })),
          bodies: Array.from({ length: 5 }, (_, index) => ({ text: `Mensagem ${index + 1}`, adlabels: [label('body', index + 1)] })),
          titles: Array.from({ length: 5 }, (_, index) => ({ text: `Titulo ${index + 1}`, adlabels: [label('title', index + 1)] })),
          descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `Descricao ${index + 1}`, adlabels: [label('description', index + 1)] })),
          link_urls: Array.from({ length: 5 }, (_, index) => ({ website_url: link, adlabels: [label('link', index + 1)] })),
          call_to_action_types: ['LEARN_MORE'],
          call_to_actions: [{ type: 'LEARN_MORE', value: { link }, adlabels: [label('cta', 1)] }],
          carousels: [{ multi_share_optimized: false, adlabels: [label('carousel', 1)], child_attachments: Array.from({ length: 5 }, (_, index) => card(index + 1)) }],
        },
        degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: 'OPT_IN' } } },
      },
      adPayload: { name: 'Carousel test', status: 'ACTIVE', adset_id: '789' },
      advantage_plus_requested_features: [],
    },
  }], { 'Restore Publish Groups': [] });
  assert.equal(output[0].json.meta_creative_validation.carousel_card_count, 5);
  assert.equal(output[0].json.meta_creative_validation.media_variant, 'carousel');
});
