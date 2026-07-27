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

test('accepts one five-card carousel creative and forbids an asset feed', () => {
  const link = 'https://espacofacial.com/agendamento?unit=barrashoppingsul';
  const card = (index) => ({
    link, image_hash: `hash-${index}`, name: `Titulo ${index}`, description: `Descricao ${index}`,
    call_to_action: { type: 'LEARN_MORE', value: { link } },
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
        object_story_spec: {
          page_id: '456',
          link_data: {
            link, message: 'Mensagem', name: 'Titulo', description: 'Descricao', multi_share_optimized: false,
            call_to_action: { type: 'LEARN_MORE', value: { link } },
            child_attachments: Array.from({ length: 5 }, (_, index) => card(index + 1)),
          },
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
