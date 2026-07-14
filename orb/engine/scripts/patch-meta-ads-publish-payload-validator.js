#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const VALIDATOR_NODE_NAME = 'Validate Meta Creative Payload';
const PREPARE_FALLBACK_NODE_NAME = 'Prepare Meta Creative Fallback';
const FALLBACK_NODE_NAME = 'Create AdCreative Fallback';

function validatorCode() {
  return String.raw`const DEFAULT_CTA_TYPE = 'WHATSAPP_MESSAGE';
const DEFAULT_LINK_URL = 'https://api.whatsapp.com/send';
const MAX_BODY_LENGTH = 240;
const MAX_TITLE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 60;

function safeString(value) {
  return String(value ?? '').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function removeEmptyFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeEmptyFields).filter((item) => item !== undefined && item !== null);
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

function toHttps(url) {
  const value = safeString(url);
  return value ? value.replace(/^http:\/\//i, 'https://') : '';
}

function truncateAtWord(value, maxLength) {
  const text = safeString(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > Math.floor(maxLength * 0.65) ? sliced.slice(0, lastSpace) : sliced).replace(/[,.!;:]+$/, '').trim();
}

function normalizeAdCopy(value, maxLength) {
  let text = safeString(value).replace(/\s+/g, ' ');

  const replacements = [
    [/\bd[êe]\s+adeus\s+[aà]s?\s+rugas\s+com\s+/gi, 'Conheca uma opcao de cuidado facial com '],
    [/\bd[êe]\s+adeus\s+[aà]s?\s+rugas\b/gi, 'Cuide da aparencia facial'],
    [/\bd[êe]\s+adeus\s+(a|as|à|às|ao|aos)\b/gi, 'cuide de'],
    [/\bresultado(s)?\s+(natural(is)?|garantido(s)?|perfeito(s)?)\b/gi, 'planejamento individual'],
    [/\bresultados?\b/gi, 'planejamento individual'],
    [/\bgarantid[oa]s?\b/gi, 'com avaliacao individual'],
    [/\bpermanent(e|es)\b/gi, 'com acompanhamento'],
    [/\bmelhor vers[aã]o\b/gi, 'rotina de cuidados'],
    [/\bqueridinh[oa]s?\b/gi, 'procurado'],
    [/\bseguran[cç]a,\s*/gi, 'Avaliacao individual, '],
    [/\btransform(e|ar|a)\b/gi, 'planeje'],
    [/\bsem dor\b/gi, 'com orientacao profissional'],
    [/\bvalorizar\s+seus?\s+l[aá]bios\b/gi, 'avaliar possibilidades de cuidado labial'],
    [/\breal[cç]ar\s+seus?\s+l[aá]bios\b/gi, 'avaliar cuidados labiais'],
    [/\bseus?\s+l[aá]bios\b/gi, 'a avaliacao labial'],
    [/\bpara\s+quem\s+busca\s+[^,.!?;:]*/gi, 'Para avaliacao individual'],
    [/\bse\s+a\s+ideia\s+[ée]\s+[^,.!?;:]*/gi, 'Para avaliacao individual'],
    [/\bmais\s+volume\b/gi, 'avaliacao labial individual'],
    [/\bum\s+toque\s+de\s+volume\b/gi, 'planejamento individual'],
    [/\bdefini[cç][aã]o\b/gi, 'avaliacao individual'],
    [/\bfirmeza\b/gi, 'avaliacao individual'],
    [/\bnaturalidade\b/gi, 'planejamento individual'],
    [/\bapar[eê]ncia\s+natural\b/gi, 'avaliacao individual'],
    [/\b50\s*%\s*OFF\b/gi, 'condicao especial'],
    [/\bvagas\s+limitadas\b/gi, 'Consulte disponibilidade'],
    [/\bdesconto\s+especial\b/gi, 'condicao especial'],
    [/\ba[cç][aã]o\s+especial\b/gi, 'condicao especial'],
    [/\bRestylane\s+Classic\b/gi, 'preenchimento labial'],
    [/\bcasais\b/gi, 'avaliacao individual'],
    [/\bnamorados\b/gi, 'avaliacao individual'],
    [/\bpromo(cional|cao|ção)?\b/gi, 'condicao informativa'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/\bcondicao especial\s+especial\b/gi, 'condicao especial')
    .replace(/\bavaliacao individual\s+individual\b/gi, 'avaliacao individual')
    .replace(/\bplanejamento individual\s+individual\b/gi, 'planejamento individual')
    .replace(/\s+([,.!?:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateAtWord(text, maxLength);
}

function extractUrlCandidate(value) {
  if (typeof value === 'string') return safeString(value);
  if (value && typeof value === 'object') {
    return safeString(value.website_url || value.url || value.href || value.link);
  }
  return '';
}

function isValidWebsiteUrl(url) {
  return /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(safeString(url));
}

function normalizeLinkUrls(list, warnings) {
  for (const entry of safeArray(list)) {
    const candidate = toHttps(extractUrlCandidate(entry));
    if (isValidWebsiteUrl(candidate)) return [{ website_url: candidate }];
  }

  warnings.push('meta_payload_validator: link_url ausente ou invalida; usando fallback WhatsApp.');
  return [{ website_url: DEFAULT_LINK_URL }];
}

function normalizeCtaTypes(list, warnings) {
  const allowed = new Set([
    'WHATSAPP_MESSAGE',
    'LEARN_MORE',
    'GET_QUOTE',
    'GET_A_QUOTE',
    'BOOK_NOW',
    'MAKE_AN_APPOINTMENT',
    'BOOK_A_CONSULTATION',
    'CONTACT_US',
    'MESSAGE_PAGE',
  ]);

  const raw = safeString(safeArray(list)[0]).toUpperCase();
  const normalized = raw === 'WHATSAPP' ? 'WHATSAPP_MESSAGE' : raw;
  if (allowed.has(normalized)) return [normalized];

  warnings.push('meta_payload_validator: CTA ausente ou invalido; usando WHATSAPP_MESSAGE.');
  return [DEFAULT_CTA_TYPE];
}

function normalizeTextAssets(list, maxItems, maxLength, fallback, warnings, label) {
  const out = [];
  const seen = new Set();
  let sanitizedCount = 0;

  for (const entry of safeArray(list)) {
    const raw = typeof entry === 'string' ? entry : entry && entry.text;
    const normalized = normalizeAdCopy(raw, maxLength);
    if (!normalized) continue;
    const rawText = safeString(raw).replace(/\s+/g, ' ');
    if (normalized !== rawText) sanitizedCount += 1;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: normalized });
    if (out.length >= maxItems) break;
  }

  if (!out.length) {
    warnings.push('meta_payload_validator: ' + label + ' ausente; usando fallback.');
    return [{ text: fallback }];
  }

  if (sanitizedCount > 0) {
    warnings.push('meta_payload_validator: ' + label + ' normalizado para politica Meta/saude (' + sanitizedCount + ' item(ns)).');
  }

  return out;
}

function primaryImageFromAssetFeed(assetFeedSpec) {
  return safeArray(assetFeedSpec && assetFeedSpec.images).find((image) => safeString(image && (image.hash || image.url))) || null;
}

function assertRequired(condition, message) {
  if (!condition) throw new Error('Meta creative payload invalido: ' + message);
}

function sanitizeAnalysis(analysis, warnings) {
  const out = deepClone(analysis || {});

  for (const key of ['adsPricing', 'spreadsheetPricing']) {
    const pricing = out[key];
    if (!pricing || typeof pricing !== 'object') continue;
    const source = safeString(pricing.source);
    if (source === 'none') {
      if (safeString(pricing.value) || safeString(pricing.offer)) {
        warnings.push('meta_payload_validator: ' + key + ' tinha source none com value/offer; limpando inconsistencia.');
      }
      pricing.value = '';
      pricing.offer = '';
    }
  }

  return out;
}

function labelName(label) {
  return safeString(label && label.name);
}

function labelSetFromAssets(assets) {
  const set = new Set();
  for (const asset of safeArray(assets)) {
    for (const label of safeArray(asset && asset.adlabels)) {
      const name = labelName(label);
      if (name) set.add(name);
    }
  }
  return set;
}

function sanitizePlacementRules(rules, imageAssets, bodyAssets, titleAssets, warnings) {
  const imageLabels = labelSetFromAssets(imageAssets);
  const bodyLabels = labelSetFromAssets(bodyAssets);
  const titleLabels = labelSetFromAssets(titleAssets);
  const out = [];

  for (const rule of safeArray(rules)) {
    const image = labelName(rule && rule.image_label);
    const body = labelName(rule && rule.body_label);
    const title = labelName(rule && rule.title_label);
    if (!imageLabels.has(image) || !bodyLabels.has(body) || !titleLabels.has(title)) {
      warnings.push('meta_payload_validator: regra de placement ignorada por label ausente.');
      continue;
    }
    out.push(deepClone(rule));
  }

  return out;
}

function buildPayloads(source, warnings) {
  const original = deepClone(source.creativePayload || {});
  const assetFeedSpec = deepClone(original.asset_feed_spec || {});

  const accountId = safeString(source.destination_ad_account_id || source.account_id).replace(/^act_/, '');
  const pageId = safeString(source.destination_page_id || source.page_id || original.object_story_spec && original.object_story_spec.page_id);
  const adsetId = safeString(source.destination_adset_id || source.adset_id || source.adPayload && source.adPayload.adset_id);
  const apiVersion = safeString(source.destination_api_version || source.api_version);
  const action = safeString(source.action);
  const ctaTypes = normalizeCtaTypes(assetFeedSpec.call_to_action_types, warnings);
  const linkUrls = normalizeLinkUrls(assetFeedSpec.link_urls, warnings);
  const primaryLinkUrl = linkUrls[0].website_url;

  const primaryImage = primaryImageFromAssetFeed(assetFeedSpec);

  assertRequired(accountId, 'destination_ad_account_id ausente');
  assertRequired(pageId, 'destination_page_id ausente');
  assertRequired(action !== 'create_new' || adsetId, 'destination_adset_id ausente para create_new');
  assertRequired(apiVersion, 'destination_api_version ausente');
  assertRequired(safeString(source.create_adcreative_url), 'create_adcreative_url ausente');
  assertRequired(primaryImage, 'nenhuma imagem com hash/url disponivel');
  assertRequired(ctaTypes[0], 'call_to_action_type ausente');

  const bodyAssets = normalizeTextAssets(
    assetFeedSpec.bodies,
    5,
    MAX_BODY_LENGTH,
    'Fale com a equipe da Espaco Facial pelo WhatsApp para saber mais.',
    warnings,
    'bodies'
  );
  const titleAssets = normalizeTextAssets(
    assetFeedSpec.titles,
    5,
    MAX_TITLE_LENGTH,
    'Agende sua avaliacao',
    warnings,
    'titles'
  );
  const descriptionAssets = normalizeTextAssets(
    assetFeedSpec.descriptions,
    1,
    MAX_DESCRIPTION_LENGTH,
    'Atendimento via WhatsApp.',
    warnings,
    'descriptions'
  );

  const originalBodyAssets = safeArray(assetFeedSpec.bodies);
  const originalTitleAssets = safeArray(assetFeedSpec.titles);

  const bodyLabels = originalBodyAssets[0] && originalBodyAssets[0].adlabels ? deepClone(originalBodyAssets[0].adlabels) : [];
  const titleLabels = originalTitleAssets[0] && originalTitleAssets[0].adlabels ? deepClone(originalTitleAssets[0].adlabels) : [];

  const flexibleBodies = bodyAssets.map((asset) => removeEmptyFields({
    text: asset.text,
    adlabels: bodyLabels,
  }));
  const flexibleTitles = titleAssets.map((asset) => removeEmptyFields({
    text: asset.text,
    adlabels: titleLabels,
  }));
  const flexibleDescriptions = descriptionAssets.map((asset) => ({ text: asset.text }));

  const flexibleImages = safeArray(assetFeedSpec.images)
    .map((image) => removeEmptyFields({
      hash: safeString(image && image.hash) || undefined,
      url: safeString(image && image.hash) ? undefined : toHttps(image && image.url),
      adlabels: deepClone(safeArray(image && image.adlabels)),
    }))
    .filter((image) => safeString(image.hash || image.url));

  assertRequired(flexibleImages.length, 'nenhuma imagem valida apos sanitizacao');

  const placementRules = sanitizePlacementRules(
    assetFeedSpec.asset_customization_rules,
    flexibleImages,
    flexibleBodies,
    flexibleTitles,
    warnings
  );

  const flexiblePayload = removeEmptyFields({
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

  return { flexiblePayload, fallbackPayload };
}

return $input.all().map((item) => {
  const source = deepClone(item.json || {});
  const warnings = safeArray(source.warnings).map((warning) => safeString(warning)).filter(Boolean);

  source.analysis = sanitizeAnalysis(source.analysis, warnings);
  const payloads = buildPayloads(source, warnings);

  return {
    json: {
      ...source,
      creativePayload: payloads.flexiblePayload,
      creativePayloadFallback: payloads.fallbackPayload,
      meta_creative_validation: {
        status: 'ok',
        applied_at: new Date().toISOString(),
        fallback_available: true,
        fallback_reason: 'meta_code_100_subcode_1487390',
        body_count: safeArray(payloads.flexiblePayload.asset_feed_spec && payloads.flexiblePayload.asset_feed_spec.bodies).length,
        title_count: safeArray(payloads.flexiblePayload.asset_feed_spec && payloads.flexiblePayload.asset_feed_spec.titles).length,
        image_count: safeArray(payloads.flexiblePayload.asset_feed_spec && payloads.flexiblePayload.asset_feed_spec.images).length,
      },
      warnings,
    },
    binary: item.binary,
  };
});`;
}

function prepareFallbackCode() {
  return String.raw`function safeString(value) {
  return String(value ?? '').trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(collectText).join(' ');
  return '';
}

function parseMetaError(source) {
  const text = collectText(source);
  const parsed = { text };

  const jsonMatch = text.match(/\{\\?"error\\?"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const cleaned = jsonMatch[0].replace(/\\"/g, '"');
      const body = JSON.parse(cleaned);
      parsed.code = body && body.error && body.error.code;
      parsed.subcode = body && body.error && body.error.error_subcode;
      parsed.message = body && body.error && body.error.message;
    } catch {}
  }

  if (parsed.code == null) {
    const codeMatch = text.match(/"code"\s*:\s*(\d+)/);
    if (codeMatch) parsed.code = Number(codeMatch[1]);
  }

  if (parsed.subcode == null) {
    const subcodeMatch = text.match(/"error_subcode"\s*:\s*(\d+)/);
    if (subcodeMatch) parsed.subcode = Number(subcodeMatch[1]);
  }

  return parsed;
}

return $input.all().map((item) => {
  const source = item.json || {};
  const fallbackPayload = source.creativePayloadFallback;
  const errorInfo = parseMetaError(source.error || source);
  const canFallback =
    Number(errorInfo.code) === 100 &&
    Number(errorInfo.subcode) === 1487390 &&
    fallbackPayload;

  if (!canFallback) {
    throw new Error('Create AdCreative falhou fora do erro de fallback suportado: ' + safeString(errorInfo.message || errorInfo.text).slice(0, 500));
  }

  return {
    json: {
      ...deepClone(source),
      creativePayload: deepClone(fallbackPayload),
      meta_creative_fallback: {
        status: 'using_fallback',
        reason: 'meta_code_100_subcode_1487390',
        original_error: errorInfo,
      },
    },
    binary: item.binary,
  };
});`;
}

function findNode(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function upsertNode(workflow, node) {
  const index = workflow.nodes.findIndex((existing) => existing.name === node.name);
  if (index >= 0) {
    workflow.nodes[index] = { ...workflow.nodes[index], ...node };
    return workflow.nodes[index];
  }
  workflow.nodes.push(node);
  return node;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function patchWorkflow(workflow) {
  const buildJobs = findNode(workflow, 'Build Jobs');
  const createAdCreative = findNode(workflow, 'Create AdCreative');
  const switchNode = findNode(workflow, 'Switch');
  const createAd = findNode(workflow, 'Create Ad');
  const updateAd = findNode(workflow, 'Update Ad');

  if (!buildJobs || !createAdCreative || !switchNode || !createAd || !updateAd) {
    throw new Error('Workflow nao contem os nos esperados para Meta Ads Publish.');
  }

  buildJobs.position = [-880, 1688];
  switchNode.position = [16, 1688];
  createAd.position = [240, 1592];
  updateAd.position = [240, 1784];

  const validateNode = upsertNode(workflow, {
    parameters: { jsCode: validatorCode() },
    id: 'f0f920f6-65d2-4ad1-836f-6550f0ad1010',
    name: VALIDATOR_NODE_NAME,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-656, 1688],
  });

  const prepareFallbackNode = upsertNode(workflow, {
    parameters: { jsCode: prepareFallbackCode() },
    id: 'f85c9f81-9584-408a-ad33-ec0a561db66c',
    name: PREPARE_FALLBACK_NODE_NAME,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-208, 1888],
  });

  const fallbackParams = clone(createAdCreative.parameters);
  fallbackParams.url = '={{ $json.create_adcreative_url }}';
  fallbackParams.jsonBody = "={{ $json.creativePayload }}";

  const fallbackNode = upsertNode(workflow, {
    parameters: fallbackParams,
    id: 'db12516d-30fd-4b52-9c88-84247c4ad94f',
    name: FALLBACK_NODE_NAME,
    type: createAdCreative.type,
    typeVersion: createAdCreative.typeVersion,
    position: [16, 1888],
    retryOnFail: true,
    waitBetweenTries: createAdCreative.waitBetweenTries || 5000,
  });

  createAdCreative.position = [-432, 1688];
  createAdCreative.parameters.jsonBody = '={{ $json.creativePayload }}';
  createAdCreative.parameters.url = '={{ $json.create_adcreative_url }}';
  createAdCreative.onError = 'continueErrorOutput';

  workflow.connections = workflow.connections || {};
  workflow.connections['Build Jobs'] = {
    main: [[{ node: validateNode.name, type: 'main', index: 0 }]],
  };
  workflow.connections[validateNode.name] = {
    main: [[{ node: createAdCreative.name, type: 'main', index: 0 }]],
  };
  workflow.connections[createAdCreative.name] = {
    main: [
      [{ node: switchNode.name, type: 'main', index: 0 }],
      [{ node: prepareFallbackNode.name, type: 'main', index: 0 }],
    ],
  };
  workflow.connections[prepareFallbackNode.name] = {
    main: [[{ node: fallbackNode.name, type: 'main', index: 0 }]],
  };
  workflow.connections[fallbackNode.name] = {
    main: [[{ node: switchNode.name, type: 'main', index: 0 }]],
  };

  return workflow;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath;

  if (!inputPath) {
    console.error('Usage: node scripts/patch-meta-ads-publish-payload-validator.js <input-workflow.json> [output-workflow.json]');
    process.exit(1);
  }

  const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const patched = patchWorkflow(workflow);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(patched, null, 2) + '\n');
  console.log(JSON.stringify({
    outputPath,
    nodeCount: patched.nodes.length,
    hasValidator: Boolean(findNode(patched, VALIDATOR_NODE_NAME)),
    hasFallback: Boolean(findNode(patched, FALLBACK_NODE_NAME)),
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  validatorCode,
  prepareFallbackCode,
  patchWorkflow,
};
