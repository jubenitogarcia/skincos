#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://api.skincos.com.br/internal/token-vault";

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function codeFor(responseBody, fallback = "gateway_request_failed") {
  const root = object(responseBody);
  return (
    text(root.error || object(root.detail).code || fallback)
      .replace(/[^a-z0-9_:-]/gi, "_")
      .slice(0, 120) || fallback
  );
}

class DiagnosticError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function trackingReadbackPolicy(destination) {
  const contract = object(destination.tracking_contract);
  const kind = text(contract.destination_kind).toLowerCase();
  if (kind === "website") {
    const websiteRequirement = text(
      contract.website_event_requirement,
    ).toLowerCase();
    const offlineRequirement = text(
      contract.offline_event_dataset_requirement,
    ).toLowerCase();
    if (
      contract.profile_configured !== true ||
      contract.production_url_tags_readback_fixture_configured !== true ||
      !["required", "not_required"].includes(websiteRequirement) ||
      !["required", "not_required"].includes(offlineRequirement)
    ) {
      throw new DiagnosticError("diagnostic_website_tracking_policy_invalid");
    }
    return {
      destination_kind: "website",
      website_event_required: websiteRequirement === "required",
      offline_event_dataset_required: offlineRequirement === "required",
      creative_url_tags_required: true,
    };
  }

  // Click-to-WhatsApp does not participate in the Website conversion
  // contract. The configuration endpoint does not require a Website profile
  // for it, so treat an absent profile as an intentionally non-Website route
  // rather than trying to infer a conversion requirement.
  return {
    destination_kind: kind === "whatsapp" ? "whatsapp" : "non_website",
    website_event_required: false,
    offline_event_dataset_required: false,
    creative_url_tags_required: false,
  };
}

function compactAdset(destination, value, creativeValue = {}) {
  // The gateway's dedicated action already projects the Graph response into
  // a reduced structure before it reaches the Token Vault journal. Keep only
  // the requirement booleans needed by the production gate and the matching
  // Graph GET state; do not return destination, profile, account, token, or
  // other configuration identifiers in operator evidence.
  const contract = object(value);
  const websiteEvent = object(contract.website_event);
  const offlineDataset = object(contract.offline_event_dataset);
  const creativeUrlTags = object(creativeValue.creative_url_tags);
  const policy = object(destination.diagnostic_policy);
  return {
    destination_kind: text(policy.destination_kind),
    website_event: {
      required: policy.website_event_required === true,
      configured: websiteEvent.configured === true,
    },
    offline_event_dataset: {
      required: policy.offline_event_dataset_required === true,
      configured: offlineDataset.configured === true,
    },
    creative_url_tags: {
      required: policy.creative_url_tags_required === true,
      paused_fixture_verified:
        policy.creative_url_tags_required === true &&
        creativeUrlTags.paused_fixture_verified === true,
      exact_match:
        policy.creative_url_tags_required === true &&
        creativeUrlTags.exact_match === true,
    },
  };
}

async function gatewayRequest({
  fetchImpl,
  baseUrl,
  bearer,
  path,
  method = "GET",
  body,
}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "user-agent": "skincos-meta-ads-conversion-contract-readback/1.0",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DiagnosticError("gateway_network_error");
  }
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || responseBody.ok !== true) {
    throw new DiagnosticError(
      codeFor(responseBody, `gateway_http_${response.status || 0}`),
    );
  }
  return responseBody;
}

function configuredDestinations(value) {
  const destinations = list(value).filter((entry) => {
    const destination = object(entry);
    return (
      text(destination.token_id) &&
      text(destination.account_id) &&
      text(destination.api_version) &&
      text(destination.adset_id) &&
      text(destination.destination_group)
    );
  });
  // This utility is intentionally scoped to the two configured destinations of
  // the publish flow.  Refuse a broadened config rather than unexpectedly
  // reading additional ad sets during an operational diagnosis.
  if (destinations.length !== 2)
    throw new DiagnosticError("diagnostic_destination_count_invalid");
  return destinations.map((destination) => ({
    ...destination,
    diagnostic_policy: trackingReadbackPolicy(destination),
  }));
}

async function readConversionContract({
  fetchImpl = fetch,
  env = process.env,
  randomUuid = () => crypto.randomUUID(),
} = {}) {
  const baseUrl = text(env.TOKEN_VAULT_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const bearer = text(env.TOKEN_VAULT_N8N_API_TOKEN);
  if (!baseUrl || !bearer)
    throw new DiagnosticError("gateway_credential_missing");

  const config = await gatewayRequest({
    fetchImpl,
    baseUrl,
    bearer,
    path: "/v1/meta-ads-publish/config",
  });
  if (
    config.ready !== true ||
    !/^[a-f0-9]{64}$/i.test(text(config.config_revision)) ||
    text(config.tracking_binding_revision).toLowerCase() !==
      text(config.config_revision).toLowerCase() ||
    text(object(config.capabilities).workflow_contract_revision) !==
      "meta_destination_contract_v20_tracking_reconciliation"
  ) {
    throw new DiagnosticError("diagnostic_config_not_ready");
  }
  const destinations = configuredDestinations(config.destinations);
  const nonce = text(randomUuid()).replace(/[^A-Za-z0-9]/g, "");
  if (!nonce) throw new DiagnosticError("diagnostic_nonce_invalid");

  const runResponse = await gatewayRequest({
    fetchImpl,
    baseUrl,
    bearer,
    path: "/v1/meta-ads-publish/runs",
    method: "POST",
    body: {
      config_revision: text(config.config_revision),
      tracking_binding_revision: text(config.tracking_binding_revision),
      workflow_contract_revision: text(
        object(config.capabilities).workflow_contract_revision,
      ),
      workflow_execution_id: `diagnostic-conversion-contract-${nonce}`,
      files: [
        {
          id: `diagnostic-no-drive-io-${nonce}`,
          name: "diagnostic-get-adset.json",
        },
      ],
    },
  });
  const runId = text(object(runResponse.run).id);
  if (!runId || runResponse.replayed === true)
    throw new DiagnosticError("diagnostic_run_not_created");

  const results = [];
  const errors = [];
  const graphActions = ["read_adset_conversion_contract"];
  if (
    destinations.some(
      (destination) =>
        object(destination.diagnostic_policy).creative_url_tags_required ===
        true,
    )
  ) {
    graphActions.push("read_authorized_creative_url_tags_contract");
  }
  let terminal = {};
  try {
    for (const [index, destination] of destinations.entries()) {
      try {
        const operation = await gatewayRequest({
          fetchImpl,
          baseUrl,
          bearer,
          path: `/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}/operations`,
          method: "POST",
          body: {
            action: "read_adset_conversion_contract",
            operation_key: `diagnostic-adset-readback-v1-${nonce}-${index}`,
            token_id: text(destination.token_id),
            account_id: text(destination.account_id),
            api_version: text(destination.api_version),
            object_id: text(destination.adset_id),
          },
        });
        if (object(operation.operation).status !== "completed") {
          throw new DiagnosticError(
            "diagnostic_conversion_contract_readback_incomplete",
          );
        }
        let creativeResult = {};
        if (
          object(destination.diagnostic_policy).creative_url_tags_required ===
          true
        ) {
          const creativeOperation = await gatewayRequest({
            fetchImpl,
            baseUrl,
            bearer,
            path: `/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}/operations`,
            method: "POST",
            body: {
              action: "read_authorized_creative_url_tags_contract",
              operation_key: `diagnostic-creative-url-tags-readback-v1-${nonce}-${index}`,
              token_id: text(destination.token_id),
              account_id: text(destination.account_id),
              api_version: text(destination.api_version),
            },
          });
          if (object(creativeOperation.operation).status !== "completed") {
            throw new DiagnosticError(
              "diagnostic_creative_url_tags_readback_incomplete",
            );
          }
          creativeResult = object(creativeOperation.operation).result;
        }
        results.push(
          compactAdset(
            destination,
            object(operation.operation).result,
            creativeResult,
          ),
        );
      } catch (error) {
        errors.push({
          code:
            error instanceof DiagnosticError
              ? error.code
              : "diagnostic_conversion_contract_readback_failed",
        });
      }
    }
  } finally {
    try {
      terminal = await gatewayRequest({
        fetchImpl,
        baseUrl,
        bearer,
        path: `/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}`,
        method: "PATCH",
        body: {
          status: "completed",
          summary: {
            kind: "diagnostic_conversion_contract_readback_v1",
            graph_actions: graphActions,
            graph_methods: ["GET"],
            no_graph_mutations: true,
            completed_destinations: results.length,
            failed_destinations: errors.length,
          },
        },
      });
    } catch (error) {
      errors.push({
        code:
          error instanceof DiagnosticError
            ? error.code
            : "diagnostic_run_completion_failed",
      });
    }
  }

  return {
    ok:
      errors.length === 0 && text(object(terminal.run).status) === "completed",
    diagnostic: {
      graph_actions: graphActions,
      graph_methods: ["GET"],
      no_graph_mutations: true,
      token_vault_journaled: true,
      run_terminal: text(object(terminal.run).status) === "completed",
      run_locks_release_requested:
        text(object(terminal.run).status) === "completed",
    },
    adsets: results,
    errors,
  };
}

async function main() {
  if (!process.argv.includes("--live")) {
    throw new DiagnosticError("live_flag_required");
  }
  const result = await readConversionContract();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    const code =
      error instanceof DiagnosticError ? error.code : "diagnostic_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exit(1);
  });
}

module.exports = {
  compactAdset,
  readConversionContract,
  trackingReadbackPolicy,
};
