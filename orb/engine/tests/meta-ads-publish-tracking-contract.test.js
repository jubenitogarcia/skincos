"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const sourceRoot = path.join(root, "workflow-src", "meta-ads-publish");

function source(name) {
  return fs.readFileSync(path.join(sourceRoot, name), "utf8");
}

function executeSource(
  name,
  { input = [], items = {}, execution = { id: "test-execution" } } = {},
) {
  const $input = { all: () => input, first: () => input[0] };
  const $items = (nodeName) => items[nodeName] || [];
  return Function(
    "$input",
    "$items",
    "$execution",
    `'use strict';\n${source(name)}`,
  )($input, $items, execution);
}

function configDestination(group, suffix) {
  return {
    row_number: suffix,
    destination_group: group,
    api_version: "v25.0",
    account_id: "123456789",
    campaign_id: "223456789",
    adset_id: `32345678${suffix}`,
    page_id: `42345678${suffix}`,
    instagram_user_id: `52345678${suffix}`,
    token_id: `facebook_${suffix}`,
    allowed_link_hosts: ["espacofacial.com"],
    landing_pages_by_creative_group: {
      DEFAULT: "https://espacofacial.com/agendamento",
    },
    tracking_contract: {
      url_tags: "key1=value1&key2=value2%20encoded",
      url_tags_configured: true,
      profile_ref: "website_schedule_v1",
      profile_configured: true,
      destination_kind: "website",
      website_event_requirement: "required",
      offline_event_dataset_requirement: "required",
      reconciliation: "enforce_from_authorized_source",
    },
    landing_page_validation: { ok: true },
  };
}

test("gateway parameters preserve declared URL tags and reject a gateway without tracking capabilities", () => {
  const rootPayload = {
    ok: true,
    ready: true,
    config_revision: "a".repeat(64),
    tracking_binding_revision: "a".repeat(64),
    capabilities: {
      workflow_contract_revision:
        "meta_destination_contract_v20_tracking_reconciliation",
      video_upload: {
        supported_actions: [
          "start_video_upload",
          "transfer_video_chunk",
          "finish_video_upload",
          "get_video_status",
        ],
        max_file_bytes: 90 * 1024 * 1024,
        max_chunk_bytes: 16 * 1024 * 1024,
      },
      tracking: {
        adset_conversion_reconciliation: true,
        creative_url_tags_readback: true,
      },
    },
    destinations: [
      configDestination("BarraShoppingSul", "1"),
      configDestination("Novo Hamburgo", "2"),
    ],
  };
  const rows = executeSource("build-meta-api-params-from-vault.js", {
    input: [{ json: rootPayload }],
  });
  assert.equal(rows.length, 2);
  assert.equal(
    rows[0].json.tracking_contract.url_tags,
    "key1=value1&key2=value2%20encoded",
  );
  assert.equal(rows[0].json.tracking_binding_revision, "a".repeat(64));
  assert.throws(
    () =>
      executeSource("build-meta-api-params-from-vault.js", {
        input: [
          {
            json: {
              ...rootPayload,
              capabilities: { ...rootPayload.capabilities, tracking: {} },
            },
          },
        ],
      }),
    /reconciliacao de conversao e url_tags/,
  );
});

test("publish-run acquisition carries the stable gateway binding and rejects a stale workflow revision", () => {
  const group = {
    config_revision: "a".repeat(64),
    tracking_binding_revision: "a".repeat(64),
    workflow_contract_revision:
      "meta_destination_contract_v20_tracking_reconciliation",
    creative_group_key: "botox",
    batch_files: [
      {
        id: "drive-1",
        name: "creative.jpg",
        modified_time: "2026-08-13T12:00:00Z",
        size: "42",
      },
    ],
  };
  const output = executeSource("prepare-publish-run.js", {
    input: [{ json: group }],
  });
  assert.deepEqual(
    {
      config_revision: output[0].json.config_revision,
      tracking_binding_revision: output[0].json.tracking_binding_revision,
      workflow_contract_revision: output[0].json.workflow_contract_revision,
    },
    {
      config_revision: "a".repeat(64),
      tracking_binding_revision: "a".repeat(64),
      workflow_contract_revision:
        "meta_destination_contract_v20_tracking_reconciliation",
    },
  );
  assert.throws(
    () =>
      executeSource("prepare-publish-run.js", {
        input: [
          {
            json: {
              ...group,
              workflow_contract_revision:
                "meta_destination_contract_v18_live_campaign_cta",
            },
          },
        ],
      }),
    /Revisao de contrato do workflow inconsistente/,
  );
});

function sourceCreative({
  destinationKind = "website",
  expectedTags = "key1=value1&key2=value2%20encoded",
} = {}) {
  const expectedFingerprint = "fnv1a:6d58875a";
  return {
    creative_id: "100000000000001",
    destination_group: "Novo Hamburgo",
    media_variant: "static_flexible",
    destination_contract: { kind: destinationKind },
    tracking_contract:
      destinationKind === "whatsapp"
        ? {
            destination_kind: "whatsapp",
            website_event_status: "not_applicable",
            url_tags_status: "not_applicable",
            url_tags_fingerprint: "",
          }
        : {
            destination_kind: "website",
            profile_ref: "website_schedule_v1",
            profile_configured: true,
            website_event_requirement: "required",
            offline_event_dataset_requirement: "required",
            website_event_status: "configured",
            offline_event_dataset_status: "configured",
            reconciliation_status: "verified",
            url_tags_status: "expected",
            url_tags_fingerprint: expectedFingerprint,
          },
    creativePayload:
      destinationKind === "whatsapp" ? {} : { url_tags: expectedTags },
    advantage_plus_requested_features: [],
    advantage_plus_feature_groups: {},
    advantage_plus_skipped_features: [],
    warnings: [],
  };
}

test("creative readback accepts exact URL tags and blocks a mismatched website tag before stage", () => {
  const sourceRow = sourceCreative();
  const response = {
    ok: true,
    operation: {
      status: "completed",
      result: {
        id: sourceRow.creative_id,
        url_tags: sourceRow.creativePayload.url_tags,
        degrees_of_freedom_spec: { creative_features_spec: {} },
      },
    },
  };
  const verified = executeSource("attach-advantage-plus-verification.js", {
    input: [{ json: response, pairedItem: { item: 0 } }],
    items: {
      "Attach Creative Result": [{ json: sourceRow }],
      "Validate Meta Placement Eligibility": [],
    },
  });
  assert.equal(
    verified[0].json.creative_tracking_verification.status,
    "verified",
  );
  assert.equal(
    verified[0].json.creative_tracking_verification.graph_request_method,
    "GET",
  );

  assert.throws(
    () =>
      executeSource("attach-advantage-plus-verification.js", {
        input: [
          {
            json: {
              ...response,
              operation: {
                ...response.operation,
                result: {
                  ...response.operation.result,
                  url_tags:
                    "utm_source=meta&utm_medium=paid_social&utm_campaign=wrong",
                },
              },
            },
            pairedItem: { item: 0 },
          },
        ],
        items: {
          "Attach Creative Result": [{ json: sourceRow }],
          "Validate Meta Placement Eligibility": [],
        },
      }),
    /Creative tracking readback divergiu antes do stage/,
  );
});

test("WhatsApp creatives remain URL-tag not-applicable and do not turn into website conversions", () => {
  const sourceRow = sourceCreative({ destinationKind: "whatsapp" });
  const output = executeSource("attach-advantage-plus-verification.js", {
    input: [
      {
        json: {
          ok: true,
          operation: {
            status: "completed",
            result: {
              id: sourceRow.creative_id,
              degrees_of_freedom_spec: { creative_features_spec: {} },
            },
          },
        },
        pairedItem: { item: 0 },
      },
    ],
    items: {
      "Attach Creative Result": [{ json: sourceRow }],
      "Validate Meta Placement Eligibility": [],
    },
  });
  assert.equal(
    output[0].json.creative_tracking_verification.status,
    "not_applicable",
  );

  const inherited = executeSource("attach-advantage-plus-verification.js", {
    input: [
      {
        json: {
          ok: true,
          operation: {
            status: "completed",
            result: {
              id: sourceRow.creative_id,
              url_tags: "utm_source=legacy&utm_medium=paid_social",
              degrees_of_freedom_spec: { creative_features_spec: {} },
            },
          },
        },
        pairedItem: { item: 0 },
      },
    ],
    items: {
      "Attach Creative Result": [{ json: sourceRow }],
      "Validate Meta Placement Eligibility": [],
    },
  });
  assert.equal(
    inherited[0].json.creative_tracking_verification.status,
    "not_applicable",
  );
  assert.equal(
    inherited[0].json.creative_tracking_verification
      .inherited_url_tags_observed,
    true,
  );
});

function nativeWebsiteCreativeForValidator({ urlTags, fingerprint } = {}) {
  return {
    run_id: "map_tracking_test",
    workflow_contract_revision:
      "meta_destination_contract_v20_tracking_reconciliation",
    token_id: "facebook_tracking",
    api_version: "v25.0",
    account_id: "123456789",
    page_id: "223456789",
    media_variant: "carousel",
    carousel_render_contract: "native_link_data",
    destination_contract: { kind: "website" },
    tracking_contract: {
      destination_kind: "website",
      profile_ref: "website_schedule_v1",
      profile_configured: true,
      website_event_requirement: "required",
      offline_event_dataset_requirement: "required",
      website_event_status: "pending_reconciliation",
      offline_event_dataset_status: "pending_reconciliation",
      reconciliation_status: "pending",
      url_tags_status: "expected",
      url_tags_fingerprint: fingerprint,
    },
    creativePayload: {
      name: "[TEST-CAROUSEL-NATIVE] Tracking",
      url_tags: urlTags,
      object_story_spec: {
        page_id: "223456789",
        link_data: {
          link: "https://espacofacial.com/agendamento?unit=novo-hamburgo",
          message: "Agende sua avaliacao.",
          call_to_action: {
            type: "BOOK_NOW",
            value: {
              link: "https://espacofacial.com/agendamento?unit=novo-hamburgo",
            },
          },
          multi_share_end_card: false,
          multi_share_optimized: false,
          child_attachments: [
            {
              image_hash: "hash-one",
              name: "Primeiro passo",
              description: "Descricao um",
              link: "https://espacofacial.com/agendamento?unit=novo-hamburgo",
            },
            {
              image_hash: "hash-two",
              name: "Segundo passo",
              description: "Descricao dois",
              link: "https://espacofacial.com/agendamento?unit=novo-hamburgo",
            },
          ],
        },
      },
    },
    adPayload: {
      name: "Tracking | Novo Hamburgo",
      status: "ACTIVE",
      adset_id: "323456789",
    },
    action: "create_new",
    offer_fingerprint: { status: "unverified", replacement_eligible: false },
    offer_replacement_guard: { reason: "no_match" },
    warnings: [],
  };
}

test("validator accepts a declared website URL-tag fingerprint while reconciliation is pending and rejects drift before an ad stage", () => {
  const urlTags = "key1=value1&key2=value2%20encoded";
  const valid = nativeWebsiteCreativeForValidator({
    urlTags,
    fingerprint: "fnv1a:6d58875a",
  });
  const passed = executeSource("validate-meta-creative-payload.js", {
    input: [{ json: valid }],
  });
  assert.equal(
    passed[0].json.meta_creative_validation.tracking_contract_status,
    "pending_reconciliation",
  );
  assert.equal(
    passed[0].json.meta_creative_validation.url_tags_fingerprint,
    "fnv1a:6d58875a",
  );
  assert.throws(
    () =>
      executeSource("validate-meta-creative-payload.js", {
        input: [
          {
            json: nativeWebsiteCreativeForValidator({
              urlTags,
              fingerprint: "fnv1a:00000000",
            }),
          },
        ],
      }),
    /url_tags_contract_mismatch/,
  );
});

test("validator accepts a Website route whose authorized profile does not require a conversion event", () => {
  const urlTags = "key1=value1&key2=value2%20encoded";
  const optional = nativeWebsiteCreativeForValidator({
    urlTags,
    fingerprint: "fnv1a:6d58875a",
  });
  optional.tracking_contract.website_event_requirement = "not_required";
  optional.tracking_contract.website_event_status = "not_required";
  optional.tracking_contract.offline_event_dataset_requirement = "not_required";
  optional.tracking_contract.offline_event_dataset_status = "not_required";
  const passed = executeSource("validate-meta-creative-payload.js", {
    input: [{ json: optional }],
  });
  assert.equal(
    passed[0].json.meta_creative_validation.tracking_contract_status,
    "pending_reconciliation",
  );
});

test("creative readback accepts an optional Website tracking profile before stage", () => {
  const sourceRow = sourceCreative();
  sourceRow.tracking_contract.website_event_requirement = "not_required";
  sourceRow.tracking_contract.website_event_status = "not_required";
  sourceRow.tracking_contract.offline_event_dataset_requirement =
    "not_required";
  sourceRow.tracking_contract.offline_event_dataset_status = "not_required";
  const output = executeSource("attach-advantage-plus-verification.js", {
    input: [
      {
        json: {
          ok: true,
          operation: {
            status: "completed",
            result: {
              id: sourceRow.creative_id,
              url_tags: sourceRow.creativePayload.url_tags,
              degrees_of_freedom_spec: { creative_features_spec: {} },
            },
          },
        },
        pairedItem: { item: 0 },
      },
    ],
    items: {
      "Attach Creative Result": [{ json: sourceRow }],
      "Validate Meta Placement Eligibility": [],
    },
  });
  assert.equal(
    output[0].json.creative_tracking_verification.status,
    "verified",
  );
});

test("tracked source files carry the conversion readback, website gate and creative-only tags", () => {
  const buildPayload = source("build-payload.js");
  const buildJobs = source("build-jobs.js");
  const validator = source("validate-meta-creative-payload.js");
  const readback = source("attach-advantage-plus-verification.js");
  assert.match(buildPayload, /conversion_tracking: deepClone/);
  assert.match(buildPayload, /tracking_contract: deepClone/);
  assert.match(buildJobs, /website_tracking_profile_not_configured/);
  assert.match(buildJobs, /pending_reconciliation/);
  assert.match(buildJobs, /website_url_tags_contract_missing/);
  assert.match(buildJobs, /url_tags: trackingContract\.expected_url_tags/);
  assert.match(buildJobs, /tracking_contract: publicTrackingContract/);
  assert.match(validator, /validateTrackingContract/);
  assert.match(readback, /creative_tracking_verification/);
  assert.match(readback, /url_tags_graph_mismatch/);
  assert.match(
    source("prepare-creative-operation.js"),
    /trackingGatewayFields/,
  );
  assert.match(
    source("build-stage-batch.js"),
    /destination_adset_id: text\(job\.destination_adset_id\)/,
  );
  assert.match(source("prepare-publish-run.js"), /tracking_binding_revision/);
  assert.equal(
    source("prepare-publish-run.js").includes(
      "creative_payload_v14_tracking_reconciliation",
    ),
    true,
  );
});
