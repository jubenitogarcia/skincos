"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  readConversionContract,
} = require("../scripts/read-meta-ads-conversion-contract");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function destination(
  destinationGroup,
  suffix,
  {
    destinationKind = "website",
    websiteEventRequirement = "required",
    offlineEventDatasetRequirement = "required",
  } = {},
) {
  return {
    destination_group: destinationGroup,
    token_id: `facebook_${suffix}`,
    account_id: "123456789",
    api_version: "v25.0",
    adset_id: `32345678${suffix}`,
    tracking_contract:
      destinationKind === "website"
        ? {
            destination_kind: "website",
            profile_configured: true,
            profile_ref: "website_schedule_v1",
            website_event_requirement: websiteEventRequirement,
            offline_event_dataset_requirement: offlineEventDatasetRequirement,
            production_url_tags_readback_fixture_configured: true,
          }
        : { destination_kind: destinationKind },
  };
}

test("conversion diagnostic creates an isolated run, reads only the reduced conversion contract, and always terminates it", async () => {
  const calls = [];
  const result = await readConversionContract({
    env: {
      TOKEN_VAULT_BASE_URL: "https://token-vault.example.test",
      TOKEN_VAULT_N8N_API_TOKEN: "fixture-bearer",
    },
    randomUuid: () => "11111111-2222-3333-4444-555555555555",
    fetchImpl: async (url, init) => {
      const request = {
        url: new URL(url),
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(request);
      if (request.url.pathname.endsWith("/config")) {
        return json({
          ok: true,
          ready: true,
          config_revision: "a".repeat(64),
          tracking_binding_revision: "a".repeat(64),
          capabilities: {
            workflow_contract_revision:
              "meta_destination_contract_v20_tracking_reconciliation",
          },
          destinations: [
            destination("BarraShoppingSul", "1"),
            destination("Novo Hamburgo", "2"),
          ],
        });
      }
      if (request.url.pathname.endsWith("/runs")) {
        return json(
          { ok: true, replayed: false, run: { id: "map_diagnostic" } },
          201,
        );
      }
      if (request.url.pathname.endsWith("/operations")) {
        if (
          request.body.action === "read_authorized_creative_url_tags_contract"
        ) {
          return json({
            ok: true,
            operation: {
              status: "completed",
              result: {
                destination_kind: "website",
                creative_url_tags: {
                  required: true,
                  paused_fixture_verified: true,
                  exact_match: true,
                },
              },
            },
          });
        }
        return json({
          ok: true,
          operation: {
            status: "completed",
            result: {
              billing_event: "IMPRESSIONS",
              optimization_goal: "OFFSITE_CONVERSIONS",
              destination_type: "WEBSITE",
              attribution_spec: { configured: true, rule_count: 1 },
              promoted_object: {
                present: true,
                keys: [
                  "custom_event_type",
                  "offline_conversion_data_set_id",
                  "pixel_id",
                ],
                pixel_configured: true,
                custom_event_type: "SCHEDULE",
                custom_conversion_configured: false,
                offline_conversion_dataset_configured: true,
              },
              website_event: { configured: true },
              offline_event_dataset: { configured: true },
            },
          },
        });
      }
      if (
        request.method === "PATCH" &&
        request.url.pathname.endsWith("/map_diagnostic")
      ) {
        return json({ ok: true, run: { status: "completed" } });
      }
      throw new Error(`Unexpected ${request.method} ${request.url.pathname}`);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostic.graph_methods, ["GET"]);
  assert.equal(result.diagnostic.no_graph_mutations, true);
  assert.equal(result.diagnostic.run_terminal, true);
  assert.equal(result.adsets.length, 2);
  assert.equal(result.adsets[0].website_event.configured, true);
  assert.equal(result.adsets[0].website_event.required, true);
  assert.equal(result.adsets[0].offline_event_dataset.configured, true);
  assert.equal(result.adsets[0].offline_event_dataset.required, true);
  assert.deepEqual(result.adsets[0].creative_url_tags, {
    required: true,
    paused_fixture_verified: true,
    exact_match: true,
  });
  assert.equal(JSON.stringify(result).includes("123456789"), false);
  assert.equal(JSON.stringify(result).includes("987654321"), false);
  assert.equal(JSON.stringify(result).includes("facebook_1"), false);
  assert.equal(JSON.stringify(result).includes("website_schedule_v1"), false);
  assert.equal(JSON.stringify(result).includes("BarraShoppingSul"), false);
  assert.equal(Object.hasOwn(result.adsets[0], "destination_group"), false);
  assert.deepEqual(Object.keys(result.adsets[0]).sort(), [
    "creative_url_tags",
    "destination_kind",
    "offline_event_dataset",
    "website_event",
  ]);

  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST", "POST", "POST", "POST", "POST", "PATCH"],
  );
  const operationBodies = calls
    .filter((call) => call.url.pathname.endsWith("/operations"))
    .map((call) => call.body);
  assert.equal(operationBodies.length, 4);
  assert.ok(
    operationBodies.filter(
      (body) => body.action === "read_adset_conversion_contract",
    ).length === 2,
  );
  assert.ok(
    operationBodies.filter(
      (body) => body.action === "read_authorized_creative_url_tags_contract",
    ).length === 2,
  );
  assert.ok(
    operationBodies.every(
      (body) =>
        !Object.keys(body).some((key) => /payload|status|creative/i.test(key)),
    ),
  );
  const completion = calls.at(-1).body;
  assert.equal(completion.status, "completed");
  assert.equal(calls[1].body.tracking_binding_revision, "a".repeat(64));
  assert.equal(
    calls[1].body.workflow_contract_revision,
    "meta_destination_contract_v20_tracking_reconciliation",
  );
  assert.deepEqual(completion.summary.graph_methods, ["GET"]);
  assert.deepEqual(completion.summary.graph_actions, [
    "read_adset_conversion_contract",
    "read_authorized_creative_url_tags_contract",
  ]);
  assert.equal(completion.summary.no_graph_mutations, true);
});

test("conversion diagnostic still marks the isolated run terminal when one Graph read fails", async () => {
  const calls = [];
  let operationCount = 0;
  const result = await readConversionContract({
    env: {
      TOKEN_VAULT_BASE_URL: "https://token-vault.example.test",
      TOKEN_VAULT_N8N_API_TOKEN: "fixture-bearer",
    },
    randomUuid: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ method: init.method, pathname: parsed.pathname });
      if (parsed.pathname.endsWith("/config"))
        return json({
          ok: true,
          ready: true,
          config_revision: "b".repeat(64),
          tracking_binding_revision: "b".repeat(64),
          capabilities: {
            workflow_contract_revision:
              "meta_destination_contract_v20_tracking_reconciliation",
          },
          destinations: [
            destination("BarraShoppingSul", "1"),
            destination("Novo Hamburgo", "2"),
          ],
        });
      if (parsed.pathname.endsWith("/runs"))
        return json(
          { ok: true, replayed: false, run: { id: "map_diagnostic" } },
          201,
        );
      if (parsed.pathname.endsWith("/operations")) {
        operationCount += 1;
        return operationCount === 1
          ? json({ ok: false, error: "meta_operation_failed" }, 502)
          : operationCount === 2
            ? json({
                ok: true,
                operation: {
                  status: "completed",
                  result: {
                    promoted_object: {},
                    attribution_spec: {},
                    website_event: {},
                    offline_event_dataset: {},
                  },
                },
              })
            : json({
                ok: true,
                operation: {
                  status: "completed",
                  result: {
                    destination_kind: "website",
                    creative_url_tags: {
                      required: true,
                      paused_fixture_verified: true,
                      exact_match: true,
                    },
                  },
                },
              });
      }
      if (init.method === "PATCH")
        return json({ ok: true, run: { status: "completed" } });
      throw new Error("unexpected request");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.run_terminal, true);
  assert.equal(result.errors.length, 1);
  assert.equal(calls.at(-1).method, "PATCH");
});

test("conversion diagnostic exposes only safe booleans for an optional Website profile and never requires Website fields for WhatsApp", async () => {
  const result = await readConversionContract({
    env: {
      TOKEN_VAULT_BASE_URL: "https://token-vault.example.test",
      TOKEN_VAULT_N8N_API_TOKEN: "fixture-bearer",
    },
    randomUuid: () => "cccccccc-dddd-eeee-ffff-000000000000",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/config")) {
        return json({
          ok: true,
          ready: true,
          config_revision: "c".repeat(64),
          tracking_binding_revision: "c".repeat(64),
          capabilities: {
            workflow_contract_revision:
              "meta_destination_contract_v20_tracking_reconciliation",
          },
          destinations: [
            destination("Optional Website", "1", {
              websiteEventRequirement: "not_required",
              offlineEventDatasetRequirement: "not_required",
            }),
            destination("WhatsApp", "2", { destinationKind: "whatsapp" }),
          ],
        });
      }
      if (parsed.pathname.endsWith("/runs"))
        return json(
          { ok: true, replayed: false, run: { id: "map_diagnostic" } },
          201,
        );
      if (parsed.pathname.endsWith("/operations")) {
        const body = JSON.parse(init.body);
        if (body.action === "read_authorized_creative_url_tags_contract") {
          return json({
            ok: true,
            operation: {
              status: "completed",
              result: {
                destination_kind: "website",
                creative_url_tags: {
                  required: true,
                  paused_fixture_verified: true,
                  exact_match: true,
                },
              },
            },
          });
        }
        return json({
          ok: true,
          operation: {
            status: "completed",
            result: {
              promoted_object: {
                pixel_id: "real-pixel-id-must-not-leak",
                offline_conversion_data_set_id: "real-dataset-id-must-not-leak",
              },
              website_event: { configured: false },
              offline_event_dataset: { configured: false },
            },
          },
        });
      }
      if (init.method === "PATCH")
        return json({ ok: true, run: { status: "completed" } });
      throw new Error("unexpected request");
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.adsets, [
    {
      destination_kind: "website",
      website_event: { required: false, configured: false },
      offline_event_dataset: { required: false, configured: false },
      creative_url_tags: {
        required: true,
        paused_fixture_verified: true,
        exact_match: true,
      },
    },
    {
      destination_kind: "whatsapp",
      website_event: { required: false, configured: false },
      offline_event_dataset: { required: false, configured: false },
      creative_url_tags: {
        required: false,
        paused_fixture_verified: false,
        exact_match: false,
      },
    },
  ]);
  assert.equal(
    JSON.stringify(result).includes("real-pixel-id-must-not-leak"),
    false,
  );
  assert.equal(
    JSON.stringify(result).includes("real-dataset-id-must-not-leak"),
    false,
  );
  assert.equal(JSON.stringify(result).includes("Optional Website"), false);
});
