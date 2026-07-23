#!/usr/bin/env node
'use strict';

const BASE_URL = String(
  process.env.TOKEN_VAULT_BASE_URL
    || 'https://api.skincos.com.br/internal/token-vault',
).replace(/\/$/, '');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function normalizedList(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function effectivePlacements(targeting, configuredKey, effectiveKey) {
  const effective = normalizedList(targeting?.[effectiveKey]);
  return effective.length ? effective : normalizedList(targeting?.[configuredKey]);
}

function validateRequiredPlacements(check) {
  const targeting = check.targeting || {};
  const publishers = effectivePlacements(targeting, 'publisher_platforms', 'effective_publisher_platforms');
  const facebook = effectivePlacements(targeting, 'facebook_positions', 'effective_facebook_positions');
  const instagram = effectivePlacements(targeting, 'instagram_positions', 'effective_instagram_positions');
  const audienceNetwork = effectivePlacements(targeting, 'audience_network_positions', 'effective_audience_network_positions');
  const whatsapp = effectivePlacements(targeting, 'whatsapp_positions', 'effective_whatsapp_positions');
  const missing = [];
  for (const publisher of ['facebook', 'instagram', 'audience_network', 'whatsapp']) {
    if (!publishers.includes(publisher)) missing.push(`publisher:${publisher}`);
  }
  if (!['instream_video', 'instream_reel'].some((entry) => facebook.includes(entry))) missing.push('facebook:instream_video');
  if (!facebook.includes('story')) missing.push('facebook:story');
  if (!['facebook_reels', 'fb_reels'].some((entry) => facebook.includes(entry))) missing.push('facebook:facebook_reels');
  if (!facebook.includes('feed')) missing.push('facebook:feed');
  if (!facebook.includes('search')) missing.push('facebook:search');
  for (const placement of ['story', 'reels']) {
    if (!instagram.includes(placement)) missing.push(`instagram:${placement}`);
  }
  if (!audienceNetwork.includes('classic')) missing.push('audience_network:classic');
  if (!whatsapp.some((entry) => entry.includes('status'))) missing.push('whatsapp:status');
  return missing;
}

function summarizeCreativeCropEvidence(ads) {
  const cropKeys = new Set();
  let searchRules = 0;
  let searchRulesWithHorizontalCrop = 0;
  for (const ad of Array.isArray(ads) ? ads : []) {
    const feed = ad?.creative?.asset_feed_spec || {};
    const images = Array.isArray(feed.images) ? feed.images : [];
    const labels = new Map();
    for (const image of images) {
      for (const label of Array.isArray(image?.adlabels) ? image.adlabels : []) {
        if (label?.name) labels.set(String(label.name), image);
      }
      for (const key of Object.keys(image?.image_crops || {})) cropKeys.add(key);
    }
    for (const rule of Array.isArray(feed.asset_customization_rules) ? feed.asset_customization_rules : []) {
      const positions = normalizedList(rule?.customization_spec?.facebook_positions);
      if (!positions.includes('search')) continue;
      searchRules += 1;
      const image = labels.get(String(rule?.image_label?.name || ''));
      if (image?.image_crops?.['191x100']) searchRulesWithHorizontalCrop += 1;
    }
  }
  return {
    observed_image_crop_keys: [...cropKeys].sort(),
    search_customization_rules: searchRules,
    search_rules_with_191x100_crop: searchRulesWithHorizontalCrop,
  };
}

async function request(pathname, token, init = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const detail = body.detail || {};
    const diagnosis = [
      body.error || 'unknown_error',
      detail.classification,
      detail.code ? `code=${detail.code}` : '',
      detail.error_subcode ? `subcode=${detail.error_subcode}` : '',
      detail.message,
      detail.fbtrace_id ? `trace=${detail.fbtrace_id}` : '',
    ].filter(Boolean).join(' | ');
    throw new Error(`${pathname} failed with HTTP ${response.status}: ${diagnosis}`);
  }
  return body;
}

async function main() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  let token;
  try {
    const result = await client.query(
      `SELECT value FROM n8n_runtime.variables WHERE key = 'TOKEN_VAULT_API_TOKEN'`,
    );
    token = String(result.rows[0]?.value || '').trim();
  } finally {
    await client.end();
  }
  if (!token) throw new Error('TOKEN_VAULT_API_TOKEN is not configured in n8n.');

  const health = await request('/health', token);
  const config = await request('/v1/meta-ads-publish/config', token);
  if (!config.ready || config.count < 2 || config.secrets_exposed !== false) {
    throw new Error('Meta Ads Publish gateway configuration is not production-ready.');
  }
  const forbidden = JSON.stringify(config).match(/access_token|bearer|fbToken/i);
  if (forbidden) throw new Error(`Gateway config exposed forbidden field: ${forbidden[0]}`);

  const landingPageCoverage = config.destinations.map((destination) => {
    const pages = destination?.landing_pages_by_creative_group;
    const configuredGroups = pages && typeof pages === 'object' && !Array.isArray(pages)
      ? Object.keys(pages).filter(Boolean)
      : [];
    return {
      destination_group: destination.destination_group,
      configured_creative_groups: configuredGroups.length,
      validation_ok: destination?.landing_page_validation?.ok === true,
    };
  });
  const invalidLandingCoverage = landingPageCoverage.filter((entry) => (
    entry.configured_creative_groups === 0 || !entry.validation_ok
  ));
  if (invalidLandingCoverage.length) {
    throw new Error(`Meta Ads Publish landing page contract is not ready: ${JSON.stringify(invalidLandingCoverage)}`);
  }

  const inventories = [];
  const accounts = new Map();
  for (const destination of config.destinations) {
    const key = `${destination.account_id}:${destination.api_version}`;
    if (!accounts.has(key)) {
      accounts.set(key, {
        ...destination,
        adsets: [],
      });
    }
    accounts.get(key).adsets.push({
      adset_id: destination.adset_id,
      destination_group: destination.destination_group,
    });
  }
  for (const destination of accounts.values()) {
    const adsets = [...new Map(destination.adsets
      .filter((entry) => entry.adset_id)
      .map((entry) => [entry.adset_id, entry])).values()];
    const inventory = await request('/v1/meta-ads-publish/inventory', token, {
      method: 'POST',
      body: JSON.stringify({
        token_id: destination.token_id,
        account_id: destination.account_id,
        api_version: destination.api_version,
        adsets,
      }),
    });
    if (!Array.isArray(inventory.placement_checks)
      || inventory.placement_checks.length !== adsets.length) {
      throw new Error('Meta Ads Publish gateway did not return every requested adset placement check.');
    }
    const placementFailures = inventory.placement_checks
      .map((entry) => ({
        destination_group: entry.destination_group,
        missing: validateRequiredPlacements(entry),
      }))
      .filter((entry) => entry.missing.length);
    if (placementFailures.length) {
      throw new Error(`Meta Ads Publish adsets are not eligible for every required vertical placement: ${JSON.stringify(placementFailures)}`);
    }
    inventories.push({
      account_suffix: String(destination.account_id).slice(-4),
      api_version: destination.api_version,
      item_count: inventory.item_count,
      page_count: inventory.page_count,
      truncated: inventory.truncated,
      creative_crop_evidence: summarizeCreativeCropEvidence(inventory.data),
      placement_checks: inventory.placement_checks.map((entry) => ({
        destination_group: entry.destination_group,
        targeting_fields: Object.keys(entry.targeting || {}).sort(),
        required_placements: 'ok',
      })),
      rate_warning: Boolean(inventory.rate_usage?.warning),
      pause_recommended: Boolean(inventory.rate_usage?.pause_recommended),
    });
  }

  console.log(JSON.stringify({
    ok: true,
    health: health.ok,
    destinations: config.count,
    config_revision_present: /^[a-f0-9]{64}$/.test(config.config_revision || ''),
    secrets_exposed: config.secrets_exposed,
    landing_page_coverage: landingPageCoverage,
    inventories,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
