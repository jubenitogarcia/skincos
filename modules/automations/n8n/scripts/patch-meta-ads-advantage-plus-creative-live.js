#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const WORKFLOW_NAME = 'Meta Ads – Publish';
const AUTHORS = 'Codex';
const EXPORT_PATH = path.join(runtimePaths.workflowsDir, 'meta-ads-publish.current.json');

function loadPgClient() {
  try {
    return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client;
  } catch {
    try {
      return require('pg').Client;
    } catch {
      throw new Error('Nao foi possivel carregar o cliente pg no runtime WSL.');
    }
  }
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || '',
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    versionCounter: Number(row.versionCounter || 0),
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

function findNode(workflow, name) {
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function upsertNode(workflow, definition) {
  const index = workflow.nodes.findIndex((entry) => entry && entry.name === definition.name);
  if (index >= 0) {
    workflow.nodes[index] = {
      ...workflow.nodes[index],
      ...definition,
      parameters: definition.parameters ?? workflow.nodes[index].parameters,
    };
    return workflow.nodes[index];
  }
  workflow.nodes.push(definition);
  return definition;
}

function replaceConnections(connections, sourceNode, outputs) {
  connections[sourceNode] = {
    main: outputs.map((slot) => slot.map((edge) => ({ ...edge, type: 'main' }))),
  };
}

function ensureContains(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`Patch incompleto: ${label}`);
  }
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Nao foi possivel localizar marcador para ${label}.`);
  }
  return text.replace(search, replacement);
}

function patchBuildMetaApiParamsFromVault(code) {
  return code.replace(/cfg\.api_version \|\| 'v24\.0'/g, "cfg.api_version || 'v25.0'");
}

function patchBuildJobs(code) {
  let next = code;

  next = next.replace(/'v24\.0'/g, "'v25.0'");

  const advantagePlusHelpers = String.raw`
function removeEmptyFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeEmptyFields).filter((item) => item !== undefined && item !== null && item !== '');
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const cleaned = removeEmptyFields(inner);
      const emptyObject = cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0;
      const emptyArray = Array.isArray(cleaned) && cleaned.length === 0;
      if (cleaned !== undefined && cleaned !== null && cleaned !== '' && !emptyObject && !emptyArray) {
        out[key] = cleaned;
      }
    }
    return out;
  }
  return value;
}

const ADVANTAGE_PLUS_SITE_LINKS_MIN = 2;
const ADVANTAGE_PLUS_SITE_LINKS_MAX = 4;
const ADVANTAGE_PLUS_BASE_FEATURES = [
  'image_touchups',
  'inline_comment',
  'text_optimizations',
  'enhance_cta',
  'image_brightness_and_contrast',
  'image_animation',
];

function parseApiVersionMajor(version) {
  const match = safeString(version).match(/^v?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function advantagePlusFeatureKeyMode(apiVersion) {
  return parseApiVersionMajor(apiVersion) >= 25 ? 'add_text_overlay' : 'image_template';
}

function normalizeSiteLinks(list) {
  const out = [];
  const seen = new Set();
  for (const entry of safeArray(list)) {
    const title = safeString(
      typeof entry === 'string'
        ? ''
        : entry && (entry.title || entry.site_link_title || entry.name || entry.label)
    );
    const url = toHttps(extractUrlCandidate(entry));
    if (!title || !isValidWebsiteUrl(url)) continue;
    const key = title.toLowerCase() + '::' + url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      site_link_title: title,
      site_link_url: url,
    });
    if (out.length >= ADVANTAGE_PLUS_SITE_LINKS_MAX) break;
  }
  return out;
}

function buildAdvantagePlusRequest(apiVersion, siteLinks) {
  const creativeFeaturesSpec = {};
  for (const feature of ADVANTAGE_PLUS_BASE_FEATURES) {
    creativeFeaturesSpec[feature] = { enroll_status: 'OPT_IN' };
  }
  const featureKeyMode = advantagePlusFeatureKeyMode(apiVersion);
  creativeFeaturesSpec[featureKeyMode] = { enroll_status: 'OPT_IN' };

  const siteLinksEligible = siteLinks.length >= ADVANTAGE_PLUS_SITE_LINKS_MIN;
  if (siteLinksEligible) {
    creativeFeaturesSpec.site_extensions = { enroll_status: 'OPT_IN' };
  }

  return {
    featureKeyMode,
    requestedFeatures: Object.keys(creativeFeaturesSpec),
    siteLinksEligible,
    siteLinks: deepClone(siteLinks),
    creativeFeaturesSpec,
    creativeSourcingSpec: siteLinksEligible
      ? {
          site_links_spec: siteLinks.map((link) => ({
            site_link_title: safeString(link.site_link_title || link.title),
            site_link_url: toHttps(link.site_link_url || link.url),
          })),
        }
      : undefined,
  };
}
`;

  next = replaceOnce(
    next,
    `function createLabel(seed, type, index) {`,
    `${advantagePlusHelpers}\n\nfunction createLabel(seed, type, index) {`,
    'Build Jobs Advantage+ helpers',
  );

  next = replaceOnce(
    next,
    `    const linkUrls = normalizeLinkUrls(overrides.link_urls);
    const ctaTypes = normalizeCtaTypes(overrides.call_to_action_types);

    const sourceAdName = safeString(`,
    `    const linkUrls = normalizeLinkUrls(overrides.link_urls);
    const ctaTypes = normalizeCtaTypes(overrides.call_to_action_types);
    const requestedRawSiteLinks = safeArray(overrides.site_links || overrides.siteLinks || ai.site_links || ai.siteLinks);
    const siteLinks = normalizeSiteLinks(requestedRawSiteLinks);
    if (requestedRawSiteLinks.length && siteLinks.length < ADVANTAGE_PLUS_SITE_LINKS_MIN) {
      warnings.push('Advantage+ site links recebidos da IA, mas menos de 2 links HTTPS validos restaram apos a sanitizacao; site_extensions sera omitido.');
    }
    if (requestedRawSiteLinks.length > ADVANTAGE_PLUS_SITE_LINKS_MAX) {
      warnings.push('Advantage+ site links acima do limite; apenas os 4 primeiros links validos serao considerados.');
    }

    const sourceAdName = safeString(`,
    'Build Jobs site links ingestion',
  );

  next = replaceOnce(
    next,
    `    const safeLinkUrls = [{ website_url: primaryLinkUrl }];
    const adMutationPayload = {`,
    `    const safeLinkUrls = [{ website_url: primaryLinkUrl }];
    const advantagePlusRequest = buildAdvantagePlusRequest(resolvedApiVersion, siteLinks);
    const adMutationPayload = {`,
    'Build Jobs Advantage+ request assembly',
  );

  next = replaceOnce(
    next,
    `    const creativePayload = useFlexibleCreative
      ? {
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
          },
          asset_feed_spec: {
            ad_formats: ['SINGLE_IMAGE'],
            optimization_type: 'PLACEMENT',
            images: imageAssets,
            bodies: bodyAssets,
            titles: titleAssets,
            descriptions: descriptionAssets,
            link_urls: safeLinkUrls,
            call_to_action_types: ctaTypes,
            asset_customization_rules: placementRules,
          },
        }
      : {
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
            link_data: {
              link: primaryLinkUrl,
              message: safeString(bodyAssets[0] && bodyAssets[0].text),
              name: safeString(titleAssets[0] && titleAssets[0].text).slice(0, 80),
              description: safeString(descriptionAssets[0] && descriptionAssets[0].text),
              image_hash: safeString(imageAssets[0] && imageAssets[0].hash) || undefined,
              picture: safeString(imageAssets[0] && imageAssets[0].hash)
                ? undefined
                : toHttps(orderedAssets[0] && orderedAssets[0].url),
              call_to_action: {
                type: ctaTypes[0] || DEFAULT_CTA_TYPE,
                value: { link: primaryLinkUrl },
              },
            },
          },
        };`,
    `    const creativeRootExtras = removeEmptyFields({
      degrees_of_freedom_spec: {
        creative_features_spec: deepClone(advantagePlusRequest.creativeFeaturesSpec),
      },
      creative_sourcing_spec: advantagePlusRequest.siteLinksEligible
        ? deepClone(advantagePlusRequest.creativeSourcingSpec)
        : undefined,
    });

    const creativePayload = useFlexibleCreative
      ? removeEmptyFields({
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
          },
          asset_feed_spec: {
            ad_formats: ['SINGLE_IMAGE'],
            optimization_type: 'PLACEMENT',
            images: imageAssets,
            bodies: bodyAssets,
            titles: titleAssets,
            descriptions: descriptionAssets,
            link_urls: safeLinkUrls,
            call_to_action_types: ctaTypes,
            asset_customization_rules: placementRules,
          },
          ...creativeRootExtras,
        })
      : removeEmptyFields({
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
            link_data: {
              link: primaryLinkUrl,
              message: safeString(bodyAssets[0] && bodyAssets[0].text),
              name: safeString(titleAssets[0] && titleAssets[0].text).slice(0, 80),
              description: safeString(descriptionAssets[0] && descriptionAssets[0].text),
              image_hash: safeString(imageAssets[0] && imageAssets[0].hash) || undefined,
              picture: safeString(imageAssets[0] && imageAssets[0].hash)
                ? undefined
                : toHttps(orderedAssets[0] && orderedAssets[0].url),
              call_to_action: {
                type: ctaTypes[0] || DEFAULT_CTA_TYPE,
                value: { link: primaryLinkUrl },
              },
            },
          },
          ...creativeRootExtras,
        });`,
    'Build Jobs creative payload enrichment',
  );

  next = replaceOnce(
    next,
    `        creativePayload,

        adPayload: deepClone(adMutationPayload),`,
    `        creativePayload,
        advantage_plus_request: {
          requested_features: deepClone(advantagePlusRequest.requestedFeatures),
          feature_key_mode: safeString(advantagePlusRequest.featureKeyMode),
          site_links: deepClone(advantagePlusRequest.siteLinks),
          site_extensions_enabled: Boolean(advantagePlusRequest.siteLinksEligible),
        },
        advantage_plus_requested_features: deepClone(advantagePlusRequest.requestedFeatures),
        advantage_plus_final_features: deepClone(advantagePlusRequest.requestedFeatures),
        advantage_plus_applied_features: [],
        advantage_plus_removed_features: [],
        advantage_plus_feature_key_mode: safeString(advantagePlusRequest.featureKeyMode),
        advantage_plus_site_links: deepClone(advantagePlusRequest.siteLinks),
        site_links_requested_count: safeArray(advantagePlusRequest.siteLinks).length,
        site_links_applied: [],
        advantage_plus_verification: {
          status: 'pending',
          requested_features: deepClone(advantagePlusRequest.requestedFeatures),
          site_links_requested_count: safeArray(advantagePlusRequest.siteLinks).length,
          site_extensions_requested: Boolean(advantagePlusRequest.siteLinksEligible),
        },

        adPayload: deepClone(adMutationPayload),`,
    'Build Jobs Advantage+ debug fields',
  );

  ensureContains(next, 'degrees_of_freedom_spec', 'Build Jobs sem degrees_of_freedom_spec');
  ensureContains(next, 'creative_sourcing_spec', 'Build Jobs sem creative_sourcing_spec');
  ensureContains(next, 'advantage_plus_requested_features', 'Build Jobs sem debug Advantage+');
  ensureContains(next, 'site_links_spec', 'Build Jobs sem site links');
  ensureContains(next, "'v25.0'", 'Build Jobs sem default v25.0');

  return next;
}

function patchValidateMetaCreativePayload(code) {
  let next = code;

  next = replaceOnce(
    next,
    `const MAX_DESCRIPTION_LENGTH = 60;`,
    `const MAX_DESCRIPTION_LENGTH = 60;
const ADVANTAGE_PLUS_SITE_LINKS_MIN = 2;
const ADVANTAGE_PLUS_SITE_LINKS_MAX = 4;`,
    'Validate Advantage+ constants',
  );

  const validateHelpers = String.raw`
function parseApiVersionMajor(version) {
  const match = safeString(version).match(/^v?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function advantagePlusFeatureKeyMode(apiVersion) {
  return parseApiVersionMajor(apiVersion) >= 25 ? 'add_text_overlay' : 'image_template';
}

function normalizeSiteLinks(list, warnings) {
  const out = [];
  const seen = new Set();
  for (const entry of safeArray(list)) {
    const title = safeString(
      typeof entry === 'string'
        ? ''
        : entry && (entry.title || entry.site_link_title || entry.name || entry.label)
    );
    const url = toHttps(extractUrlCandidate(entry));
    if (!title || !isValidWebsiteUrl(url)) continue;
    const key = title.toLowerCase() + '::' + url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      site_link_title: title,
      site_link_url: url,
    });
    if (out.length >= ADVANTAGE_PLUS_SITE_LINKS_MAX) break;
  }
  if (safeArray(list).length && out.length < ADVANTAGE_PLUS_SITE_LINKS_MIN) {
    warnings.push('meta_payload_validator: site_links insuficientes ou invalidos; site_extensions sera omitido.');
  }
  if (safeArray(list).length > ADVANTAGE_PLUS_SITE_LINKS_MAX) {
    warnings.push('meta_payload_validator: site_links acima do limite; apenas os 4 primeiros links validos foram mantidos.');
  }
  return out;
}

function buildAdvantagePlusSpec(apiVersion, source, warnings) {
  const rawSiteLinks = safeArray(
    source.advantage_plus_site_links ||
    source.advantage_plus_request && source.advantage_plus_request.site_links ||
    source.creativePayload && source.creativePayload.creative_sourcing_spec && source.creativePayload.creative_sourcing_spec.site_links_spec
  );
  const siteLinks = normalizeSiteLinks(rawSiteLinks, warnings);
  const creativeFeaturesSpec = {
    image_touchups: { enroll_status: 'OPT_IN' },
    inline_comment: { enroll_status: 'OPT_IN' },
    text_optimizations: { enroll_status: 'OPT_IN' },
    enhance_cta: { enroll_status: 'OPT_IN' },
    image_brightness_and_contrast: { enroll_status: 'OPT_IN' },
    image_animation: { enroll_status: 'OPT_IN' },
  };
  const featureKeyMode = advantagePlusFeatureKeyMode(apiVersion);
  creativeFeaturesSpec[featureKeyMode] = { enroll_status: 'OPT_IN' };
  const siteLinksEligible = siteLinks.length >= ADVANTAGE_PLUS_SITE_LINKS_MIN;
  if (siteLinksEligible) {
    creativeFeaturesSpec.site_extensions = { enroll_status: 'OPT_IN' };
  }
  return {
    featureKeyMode,
    siteLinks,
    siteLinksEligible,
    requestedFeatures: Object.keys(creativeFeaturesSpec),
    degrees_of_freedom_spec: {
      creative_features_spec: creativeFeaturesSpec,
    },
    creative_sourcing_spec: siteLinksEligible
      ? {
          site_links_spec: siteLinks.map((link) => ({
            site_link_title: safeString(link.site_link_title || link.title),
            site_link_url: toHttps(link.site_link_url || link.url),
          })),
        }
      : undefined,
  };
}
`;

  next = replaceOnce(
    next,
    `function buildPayloads(source, warnings) {`,
    `${validateHelpers}\n\nfunction buildPayloads(source, warnings) {`,
    'Validate Advantage+ helpers',
  );

  next = replaceOnce(
    next,
    `  const primaryLinkUrl = linkUrls[0].website_url;

  const primaryImage = primaryImageFromAssetFeed(assetFeedSpec);`,
    `  const primaryLinkUrl = linkUrls[0].website_url;
  const advantagePlus = buildAdvantagePlusSpec(apiVersion, source, warnings);

  const primaryImage = primaryImageFromAssetFeed(assetFeedSpec);`,
    'Validate Advantage+ payload bootstrap',
  );

  next = replaceOnce(
    next,
    `  const flexiblePayload = removeEmptyFields({
    name: safeString(original.name || source.adPayload && source.adPayload.name || source.source_ad_name),
    object_story_spec: {
      page_id: pageId,
      instagram_user_id: safeString(source.destination_instagram_user_id || source.instagram_user_id || original.object_story_spec && original.object_story_spec.instagram_user_id),
    },
    asset_feed_spec: {
      ad_formats: safeArray(assetFeedSpec.ad_formats).length ? deepClone(assetFeedSpec.ad_formats) : ['SINGLE_IMAGE'],
      optimization_type: safeString(assetFeedSpec.optimization_type || 'PLACEMENT'),
      images: flexibleImages,
      bodies: flexibleBodies,
      titles: flexibleTitles,
      descriptions: flexibleDescriptions,
      link_urls: linkUrls,
      call_to_action_types: ctaTypes,
      asset_customization_rules: placementRules.length ? placementRules : undefined,
    },
  });

  const fallbackPayload = removeEmptyFields({
    name: safeString(original.name || source.adPayload && source.adPayload.name || source.source_ad_name),
    object_story_spec: {
      page_id: pageId,
      instagram_user_id: safeString(source.destination_instagram_user_id || source.instagram_user_id || original.object_story_spec && original.object_story_spec.instagram_user_id),
      link_data: {
        link: primaryLinkUrl,
        message: bodyAssets[0].text,
        name: titleAssets[0].text,
        description: descriptionAssets[0].text,
        image_hash: safeString(primaryImage.hash) || undefined,
        picture: safeString(primaryImage.hash) ? undefined : toHttps(primaryImage.url),
        call_to_action: {
          type: ctaTypes[0],
          value: {
            link: primaryLinkUrl,
          },
        },
      },
    },
  });

  return { flexiblePayload, fallbackPayload };`,
    `  const flexiblePayload = removeEmptyFields({
    name: safeString(original.name || source.adPayload && source.adPayload.name || source.source_ad_name),
    object_story_spec: {
      page_id: pageId,
      instagram_user_id: safeString(source.destination_instagram_user_id || source.instagram_user_id || original.object_story_spec && original.object_story_spec.instagram_user_id),
    },
    asset_feed_spec: {
      ad_formats: safeArray(assetFeedSpec.ad_formats).length ? deepClone(assetFeedSpec.ad_formats) : ['SINGLE_IMAGE'],
      optimization_type: safeString(assetFeedSpec.optimization_type || 'PLACEMENT'),
      images: flexibleImages,
      bodies: flexibleBodies,
      titles: flexibleTitles,
      descriptions: flexibleDescriptions,
      link_urls: linkUrls,
      call_to_action_types: ctaTypes,
      asset_customization_rules: placementRules.length ? placementRules : undefined,
    },
    degrees_of_freedom_spec: advantagePlus.degrees_of_freedom_spec,
    creative_sourcing_spec: advantagePlus.creative_sourcing_spec,
  });

  const fallbackPayload = removeEmptyFields({
    name: safeString(original.name || source.adPayload && source.adPayload.name || source.source_ad_name),
    object_story_spec: {
      page_id: pageId,
      instagram_user_id: safeString(source.destination_instagram_user_id || source.instagram_user_id || original.object_story_spec && original.object_story_spec.instagram_user_id),
      link_data: {
        link: primaryLinkUrl,
        message: bodyAssets[0].text,
        name: titleAssets[0].text,
        description: descriptionAssets[0].text,
        image_hash: safeString(primaryImage.hash) || undefined,
        picture: safeString(primaryImage.hash) ? undefined : toHttps(primaryImage.url),
        call_to_action: {
          type: ctaTypes[0],
          value: {
            link: primaryLinkUrl,
          },
        },
      },
    },
    degrees_of_freedom_spec: advantagePlus.degrees_of_freedom_spec,
    creative_sourcing_spec: advantagePlus.creative_sourcing_spec,
  });

  return { flexiblePayload, fallbackPayload, advantagePlus };`,
    'Validate Advantage+ payload injection',
  );

  next = replaceOnce(
    next,
    `      creativePayload: payloads.flexiblePayload,
      creativePayloadFallback: payloads.fallbackPayload,
      meta_creative_validation: {`,
    `      creativePayload: payloads.flexiblePayload,
      creativePayloadFallback: payloads.fallbackPayload,
      advantage_plus_request: {
        requested_features: deepClone(payloads.advantagePlus.requestedFeatures),
        feature_key_mode: safeString(payloads.advantagePlus.featureKeyMode),
        site_links: deepClone(payloads.advantagePlus.siteLinks),
        site_extensions_enabled: Boolean(payloads.advantagePlus.siteLinksEligible),
      },
      advantage_plus_requested_features: deepClone(payloads.advantagePlus.requestedFeatures),
      advantage_plus_final_features: deepClone(payloads.advantagePlus.requestedFeatures),
      advantage_plus_feature_key_mode: safeString(payloads.advantagePlus.featureKeyMode),
      advantage_plus_site_links: deepClone(payloads.advantagePlus.siteLinks),
      advantage_plus_applied_features: safeArray(source.advantage_plus_applied_features),
      advantage_plus_removed_features: safeArray(source.advantage_plus_removed_features),
      site_links_requested_count: safeArray(payloads.advantagePlus.siteLinks).length,
      site_links_applied: safeArray(source.site_links_applied),
      advantage_plus_verification: source.advantage_plus_verification || {
        status: 'pending',
        requested_features: deepClone(payloads.advantagePlus.requestedFeatures),
        site_links_requested_count: safeArray(payloads.advantagePlus.siteLinks).length,
        site_extensions_requested: Boolean(payloads.advantagePlus.siteLinksEligible),
      },
      meta_creative_validation: {`,
    'Validate Advantage+ debug output',
  );

  next = replaceOnce(
    next,
    `        fallback_available: Boolean(source.allow_fallback_creative || source.fallback_creative_allowed),`,
    `        fallback_available: false,`,
    'Validate fallback policy hardening',
  );

  next = replaceOnce(
    next,
    `        image_count: safeArray(payloads.flexiblePayload.asset_feed_spec && payloads.flexiblePayload.asset_feed_spec.images).length,`,
    `        image_count: safeArray(payloads.flexiblePayload.asset_feed_spec && payloads.flexiblePayload.asset_feed_spec.images).length,
        site_links_requested_count: safeArray(payloads.advantagePlus.siteLinks).length,
        site_links_eligible: Boolean(payloads.advantagePlus.siteLinksEligible),
        advantage_plus_feature_key_mode: safeString(payloads.advantagePlus.featureKeyMode),
        advantage_plus_requested_features: deepClone(payloads.advantagePlus.requestedFeatures),`,
    'Validate Advantage+ validation summary',
  );

  ensureContains(next, 'creative_features_spec', 'Validate sem creative_features_spec');
  ensureContains(next, 'creative_sourcing_spec', 'Validate sem creative_sourcing_spec');
  ensureContains(next, 'site_links_spec', 'Validate sem site_links_spec');
  ensureContains(next, 'add_text_overlay', 'Validate sem compatibilidade add_text_overlay');

  return next;
}

function buildVerifyNode(existing) {
  return {
    id: existing?.id || crypto.randomUUID(),
    name: 'Verify Advantage+ Creative',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: existing?.typeVersion || 4.3,
    position: existing?.position || [240, 1240],
    parameters: {
      method: 'GET',
      url: `={{ (() => {
  const buildJob = $('Build Jobs').item.json || {};
  const creativeId = String($json.id || '').trim();
  const apiVersion = String(buildJob.destination_api_version || buildJob.api_version || 'v25.0').trim();
  return 'https://graph.facebook.com/' + apiVersion + '/' + creativeId;
})() }}`,
      sendQuery: true,
      queryParameters: {
        parameters: [
          {
            name: 'fields',
            value: 'id,name,degrees_of_freedom_spec,creative_sourcing_spec,asset_feed_spec,creative_features_spec',
          },
        ],
      },
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Authorization',
            value: `=Bearer {{ $('Build Jobs').item.json.access_token }}`,
          },
        ],
      },
      options: {
        timeout: 60000,
      },
    },
    continueOnFail: true,
    retryOnFail: true,
    waitBetweenTries: 5000,
  };
}

function buildAttachVerificationNode(existing) {
  return {
    id: existing?.id || crypto.randomUUID(),
    name: 'Attach Advantage+ Verification',
    type: 'n8n-nodes-base.code',
    typeVersion: existing?.typeVersion || 2,
    position: existing?.position || [464, 1240],
    retryOnFail: true,
    waitBetweenTries: 5000,
    parameters: {
      jsCode: String.raw`function safeString(value) {
  return String(value ?? '').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of safeArray(values)) {
    const text = safeString(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

function featureEntriesFromVerification(payload) {
  const fromDegrees = asObject(asObject(payload.degrees_of_freedom_spec).creative_features_spec);
  const fromMirror = asObject(payload.creative_features_spec);
  return { ...deepClone(fromDegrees), ...deepClone(fromMirror) };
}

function optedInFeatures(payload) {
  return Object.entries(featureEntriesFromVerification(payload))
    .filter(([, spec]) => safeString(spec && spec.enroll_status).toUpperCase() === 'OPT_IN')
    .map(([feature]) => safeString(feature))
    .filter(Boolean);
}

function normalizeAppliedSiteLinks(payload) {
  return safeArray(asObject(asObject(payload.creative_sourcing_spec).site_links_spec))
    .map((entry) => ({
      title: safeString(entry && (entry.site_link_title || entry.title)),
      url: safeString(entry && (entry.site_link_url || entry.url)),
    }))
    .filter((entry) => entry.title && entry.url);
}

const buildItems = (() => {
  try { return $items('Build Jobs') || []; } catch (error) { return []; }
})();
const creativeItems = (() => {
  try { return $items('Create AdCreative') || []; } catch (error) { return []; }
})();

return $input.all().map((item, index) => {
  const jobIndex = pairedIndex(item, index);
  const buildItem = asObject((buildItems[jobIndex] || {}).json);
  const creativeItem = asObject((creativeItems[jobIndex] || {}).json);
  const verifyJson = asObject(item.json);
  const creativeId = safeString(creativeItem.id || verifyJson.id);
  const requested = uniqueStrings(buildItem.advantage_plus_requested_features);
  const applied = uniqueStrings(optedInFeatures(verifyJson));
  const removed = requested.filter((feature) => !applied.includes(feature));
  const siteLinksApplied = normalizeAppliedSiteLinks(verifyJson);
  const rawError = asObject(verifyJson.error);
  const warningMessage = safeString(
    rawError.message ||
    rawError.error_user_msg ||
    verifyJson.message ||
    verifyJson.error ||
    ''
  );
  const verificationStatus = warningMessage ? 'warning' : 'ok';
  const warnings = uniqueStrings([
    ...safeArray(buildItem.warnings),
    ...(verificationStatus === 'warning'
      ? ['Advantage+ verification warning: ' + warningMessage]
      : []),
  ]);

  return {
    json: {
      ...deepClone(buildItem),
      id: creativeId,
      creative_id: creativeId,
      advantage_plus_applied_features: applied,
      advantage_plus_removed_features: removed,
      advantage_plus_final_features: applied.length ? applied : requested,
      site_links_applied: siteLinksApplied,
      advantage_plus_verification: {
        status: verificationStatus,
        checked_at: new Date().toISOString(),
        requested_features: requested,
        applied_features: applied,
        removed_features: removed,
        site_links_requested_count: safeArray(buildItem.advantage_plus_site_links).length,
        site_links_applied: siteLinksApplied,
        warning: warningMessage || undefined,
        response_id: safeString(verifyJson.id),
      },
      meta_creative_validation: {
        ...asObject(buildItem.meta_creative_validation),
        advantage_plus_verification_status: verificationStatus,
        site_links_requested_count: safeArray(buildItem.advantage_plus_site_links).length,
        site_links_applied_count: siteLinksApplied.length,
      },
      warnings,
    },
    binary: (buildItems[jobIndex] || {}).binary || item.binary,
    pairedItem: {
      item: jobIndex,
    },
  };
});`,
    },
  };
}

function patchWorkflow(workflow) {
  const patched = clone(workflow);

  const buildJobs = findNode(patched, 'Build Jobs');
  buildJobs.parameters.jsCode = patchBuildJobs(buildJobs.parameters.jsCode);

  const validateNode = findNode(patched, 'Validate Meta Creative Payload');
  validateNode.parameters.jsCode = patchValidateMetaCreativePayload(validateNode.parameters.jsCode);

  const buildMetaParams = findNode(patched, 'Build Meta API Params From Vault');
  buildMetaParams.parameters.jsCode = patchBuildMetaApiParamsFromVault(buildMetaParams.parameters.jsCode);

  const switchNode = findNode(patched, 'Switch');
  const createAdNode = findNode(patched, 'Create Ad');
  const updateAdNode = findNode(patched, 'Update Ad');

  const verifyNode = buildVerifyNode((patched.nodes || []).find((node) => node.name === 'Verify Advantage+ Creative'));
  const attachNode = buildAttachVerificationNode((patched.nodes || []).find((node) => node.name === 'Attach Advantage+ Verification'));
  upsertNode(patched, verifyNode);
  upsertNode(patched, attachNode);

  switchNode.position = [240, 1432];
  createAdNode.position = [464, 1336];
  updateAdNode.position = [464, 1528];

  replaceConnections(patched.connections, 'Create AdCreative', [[{ node: 'Verify Advantage+ Creative', index: 0 }]]);
  replaceConnections(patched.connections, 'Verify Advantage+ Creative', [[{ node: 'Attach Advantage+ Verification', index: 0 }]]);
  replaceConnections(patched.connections, 'Attach Advantage+ Verification', [[{ node: 'Switch', index: 0 }]]);

  const text = JSON.stringify(patched);
  ensureContains(text, 'degrees_of_freedom_spec', 'workflow sem degrees_of_freedom_spec');
  ensureContains(text, 'creative_features_spec', 'workflow sem creative_features_spec');
  ensureContains(text, 'site_links_spec', 'workflow sem site_links_spec');
  ensureContains(text, 'Verify Advantage+ Creative', 'workflow sem node de verificacao Advantage+');
  ensureContains(text, 'Attach Advantage+ Verification', 'workflow sem node de merge da verificacao');
  if (text.includes('standard_enhancements')) {
    throw new Error('Patch invalido: standard_enhancements nao deveria reaparecer no workflow.');
  }

  return patched;
}

async function persistWorkflow(client, workflow, current) {
  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString();

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO n8n_runtime.workflow_history
        ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
       VALUES ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
      [
        versionId,
        WORKFLOW_ID,
        AUTHORS,
        updatedAt,
        JSON.stringify(workflow.nodes),
        JSON.stringify(workflow.connections),
        workflow.name,
        workflow.description || '',
      ],
    );

    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET nodes = $1::json,
              connections = $2::json,
              settings = $3::json,
              "staticData" = $4::json,
              "pinData" = $5::json,
              meta = $6::json,
              "versionId" = CAST($7 AS character varying),
              "activeVersionId" = CAST($7 AS character varying),
              "updatedAt" = $8,
              "versionCounter" = COALESCE("versionCounter", 0) + 1
        WHERE id = $9`,
      [
        JSON.stringify(workflow.nodes),
        JSON.stringify(workflow.connections),
        JSON.stringify(workflow.settings || {}),
        JSON.stringify(workflow.staticData || {}),
        JSON.stringify(workflow.pinData || {}),
        JSON.stringify(workflow.meta || {}),
        versionId,
        updatedAt,
        WORKFLOW_ID,
      ],
    );

    await client.query('COMMIT');
    return {
      ...workflow,
      versionId,
      activeVersionId: versionId,
      versionCounter: Number(current.versionCounter || 0) + 1,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData" AS "staticData",
              "pinData" AS "pinData", "versionId" AS "versionId",
              "activeVersionId" AS "activeVersionId", "versionCounter" AS "versionCounter",
              meta, description
         FROM n8n_runtime.workflow_entity
        WHERE id = $1`,
      [WORKFLOW_ID],
    );
    if (!result.rows.length) throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado.`);

    const current = workflowFromRow(result.rows[0]);
    if (current.name !== WORKFLOW_NAME) {
      throw new Error(`Workflow inesperado: ${current.name}`);
    }

    const stamp = nowStamp();
    const checkpointDir = path.join(
      runtimePaths.runtimeHome,
      'exports',
      'workflow-patches',
      `advantage-plus-meta-ads-publish-${stamp}`,
    );
    const beforePath = path.join(checkpointDir, 'meta-ads-publish.before.json');
    const afterPath = path.join(checkpointDir, 'meta-ads-publish.after.json');
    writeJson(beforePath, current);

    const patched = patchWorkflow(current);
    const persisted = await persistWorkflow(client, patched, current);
    writeJson(afterPath, persisted);
    writeJson(EXPORT_PATH, persisted);

    console.log(JSON.stringify({
      workflowId: WORKFLOW_ID,
      previousVersionId: current.versionId,
      versionId: persisted.versionId,
      previousVersionCounter: current.versionCounter,
      versionCounter: persisted.versionCounter,
      beforePath,
      afterPath,
      exportPath: EXPORT_PATH,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
