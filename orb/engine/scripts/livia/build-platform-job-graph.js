#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODULE_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(MODULE_ROOT, 'workflows', 'livia.active.json');
const CHECKPOINT_DIR = path.join(MODULE_ROOT, 'workflows', 'checkpoints');
const NODE_NAME = 'BQ - Build Platform Job Graph';
const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/var/lib/skincos-runtime/orb';
const LEDGER_DIR = path.join(RUNTIME_HOME, 'state', 'livia-publish-ledger');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePayload() {
  const rawB64File = argValue('--payload-b64-file') || process.env.LIVIA_BUILD_JOB_GRAPH_PAYLOAD_B64_FILE || '';
  const rawFile = argValue('--payload-file') || process.env.LIVIA_BUILD_JOB_GRAPH_PAYLOAD_FILE || '';
  const rawB64 = (rawB64File ? fs.readFileSync(rawB64File, 'utf8') : '')
    || argValue('--payload-b64')
    || process.env.LIVIA_BUILD_JOB_GRAPH_PAYLOAD_B64
    || '';
  const raw = rawB64
    ? Buffer.from(rawB64, 'base64').toString('utf8')
    : ((rawFile ? fs.readFileSync(rawFile, 'utf8') : '')
      || argValue('--payload')
      || process.env.LIVIA_BUILD_JOB_GRAPH_PAYLOAD
      || '');
  if (!raw.trim()) fail('Missing --payload for Livia build-platform-job-graph.');
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Invalid build-platform-job-graph payload: ${error.message}`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function removeNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => removeNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = removeNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value === null ? undefined : value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sourceFromWorkflowFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const workflow = readJson(filePath);
  const node = asArray(workflow.nodes).find((entry) => entry && entry.name === NODE_NAME);
  const jsCode = String(node?.parameters?.jsCode || '');
  if (node?.type === 'n8n-nodes-base.code' && jsCode.length > 1000) {
    return { filePath, jsCode };
  }
  return null;
}

function checkpointCandidates() {
  if (!fs.existsSync(CHECKPOINT_DIR)) return [];
  return fs.readdirSync(CHECKPOINT_DIR)
    .filter((name) => /^livia\.(before|after)-qa-control\..+\.json$/i.test(name))
    .map((name) => path.join(CHECKPOINT_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function loadSource() {
  const explicitSourcePath = process.env.LIVIA_BUILD_JOB_GRAPH_SOURCE || '';
  if (explicitSourcePath) {
    return { filePath: explicitSourcePath, jsCode: fs.readFileSync(explicitSourcePath, 'utf8') };
  }

  const active = sourceFromWorkflowFile(WORKFLOW_PATH);
  if (active) return active;

  for (const filePath of checkpointCandidates()) {
    const candidate = sourceFromWorkflowFile(filePath);
    if (candidate) return candidate;
  }

  fail(`Could not find a ${NODE_NAME} Code-node source in ${WORKFLOW_PATH} or ${CHECKPOINT_DIR}.`);
}

function n8nItems(values) {
  return asArray(values).map((value) => {
    if (value && typeof value === 'object' && value.json && typeof value.json === 'object') return value;
    return { json: asObject(value) };
  });
}

function firstNonEmptyArray(...values) {
  for (const value of values) {
    const current = asArray(value);
    if (current.length) return current;
  }
  return [];
}

function firstNonEmptyObject(...values) {
  for (const value of values) {
    const current = asObject(value);
    if (Object.keys(current).length) return current;
  }
  return {};
}

function legacyInputs(payload) {
  const tokenContext = firstNonEmptyObject(payload.normalizedTokenVaultContext, payload.tokenVaultContext);
  const bootstrapItems = n8nItems(payload.bootstrapItems);
  let composeItems = bootstrapItems.filter((item) => String(item?.json?.groupKey || '').trim());

  if (!composeItems.length) {
    composeItems = n8nItems(firstNonEmptyArray(payload.normalizedCombinedMediaItems, payload.combinedMediaItems))
      .map((item) => ({
        ...item,
        json: {
          ...item.json,
          facebook: firstNonEmptyObject(item.json.facebook, tokenContext.facebook),
          instagram: firstNonEmptyObject(item.json.instagram, tokenContext.instagram),
          threads: firstNonEmptyObject(item.json.threads, tokenContext.threads),
        },
      }));
  }

  const uploadItems = n8nItems(firstNonEmptyArray(payload.normalizedCombinedMediaItems, payload.combinedMediaItems));
  const liviaItems = n8nItems(firstNonEmptyArray(payload.normalizedLiviaOutput, payload.liviaOutput));
  const aggregateItems = n8nItems(payload.aggregateCandidateUploads || []);

  return {
    'Compose (1)': composeItems,
    'Upload File': uploadItems.length ? uploadItems : composeItems,
    'Aggregate (2)': aggregateItems,
    Livia: liviaItems,
  };
}

function referencedLegacyItemNodes(jsCode) {
  const nodes = new Set();
  const matcher = /\$items\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of String(jsCode || '').matchAll(matcher)) {
    const nodeName = String(match[2] || '').trim();
    if (nodeName) nodes.add(nodeName);
  }
  return [...nodes];
}

function assertRuntimeCompatibility(jsCode) {
  const referencedNodes = referencedLegacyItemNodes(jsCode);
  const supportedNodes = new Set(['Compose (1)', 'Upload File', 'Aggregate (2)', 'Livia']);
  const unsupported = referencedNodes.filter((nodeName) => !supportedNodes.has(nodeName));
  if (unsupported.length) {
    throw new Error(
      `${NODE_NAME}: source requires unsupported legacy $items inputs (${unsupported.join(', ')}). `
      + 'Refuse promotion before a media job can reach the gateway.',
    );
  }

  const fixtureMedia = [
    { groupKey: 'single-image', groupOrder: 0, sourceMediaKind: 'image', finalUrl: 'https://example.invalid/image.jpg' },
    { groupKey: 'single-video', groupOrder: 0, sourceMediaKind: 'video', finalUrl: 'https://example.invalid/reel.mp4' },
    { groupKey: 'mixed-carousel', groupOrder: 0, sourceMediaKind: 'image', finalUrl: 'https://example.invalid/carousel-1.jpg' },
    { groupKey: 'mixed-carousel', groupOrder: 1, sourceMediaKind: 'video', finalUrl: 'https://example.invalid/carousel-2.mp4' },
  ];
  const fixturePayload = {
    bootstrapItems: fixtureMedia.map((json) => ({ json })),
    normalizedCombinedMediaItems: fixtureMedia.map((json) => ({ json })),
    aggregateCandidateUploads: fixtureMedia.map((json) => ({ json })),
    normalizedLiviaOutput: fixtureMedia.map((json) => ({ json: { ...json, alt_text: `Evidence for ${json.sourceMediaKind}` } })),
  };
  const expectedByNode = legacyInputs(fixturePayload);
  const probe = `
    const requested = ${JSON.stringify(referencedNodes)};
    for (const nodeName of requested) {
      const items = $items(nodeName);
      if (!Array.isArray(items) || items.length === 0) throw new Error('missing legacy input: ' + nodeName);
      if (!items.every((item) => item && item.json && typeof item.json === 'object')) {
        throw new Error('invalid legacy item envelope: ' + nodeName);
      }
    }
    return requested.map((nodeName) => ({ json: { nodeName, count: $items(nodeName).length } }));
  `;
  const result = executeSource(probe, fixturePayload);
  const counts = Object.fromEntries(asArray(result).map((item) => [item?.json?.nodeName, Number(item?.json?.count || 0)]));
  for (const nodeName of referencedNodes) {
    if (counts[nodeName] !== expectedByNode[nodeName].length) {
      throw new Error(`${NODE_NAME}: legacy $items compatibility mismatch for ${nodeName}.`);
    }
  }
  return {
    checked: true,
    referencedNodes,
    fixtureMediaKinds: ['image', 'video', 'mixed-carousel'],
  };
}

function executeSource(jsCode, payload) {
  const inputItems = [{ json: payload }];
  const staticData = {};
  const legacy = legacyInputs(payload);
  const fn = new Function(
    '$json',
    '$input',
    '$items',
    '$execution',
    '$getWorkflowStaticData',
    `"use strict";\n${jsCode}`,
  );
  return fn(
    payload,
    { all: () => inputItems },
    (nodeName) => asArray(legacy[nodeName]),
    { id: String(process.env.LIVIA_EXECUTION_ID || Date.now()) },
    () => staticData,
  );
}

function summarizePlatform(jobs) {
  return jobs.reduce((acc, job) => {
    const platform = String(job.platform || 'unknown');
    const phase = String(job.phase || 'unknown');
    acc[platform] ||= { total: 0, phases: {} };
    acc[platform].total += 1;
    acc[platform].phases[phase] = (acc[platform].phases[phase] || 0) + 1;
    return acc;
  }, {});
}

function normalizeUnit(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['bss', 'barra_shopping_sul', 'barrashoppingsul'].includes(raw)) return 'bss';
  if (['nh', 'novo_hamburgo', 'novohamburgo'].includes(raw)) return 'nh';
  return raw;
}

function facebookCredentialContext(payload) {
  const rawItems = [
    ...asArray(payload?.normalizedTokenVaultContext?.raw?.items),
    ...asArray(payload?.tokenVaultContext?.raw?.items),
  ];
  const byUnit = {};

  for (const token of rawItems) {
    const current = asObject(token);
    if (current.provider !== 'facebook' || current.active === false) continue;

    const unit = normalizeUnit(current.unit || current.metadata?.legacy_columns?.Unit);
    if (!unit) continue;

    const id = String(current.fbId || current.external_account_id || '').trim();
    const tokenId = String(current.token_id || current.id || '').trim();
    const isMetaAdsPublish =
      String(current.id || '').includes('meta_ads_publish') ||
      String(current.metadata?.purpose || '') === 'meta_ads_publish' ||
      Object.keys(asObject(current.metadata?.meta_ads_publish)).length > 0;

    if (!isMetaAdsPublish && id && tokenId) {
      byUnit[unit] = { id, tokenId, source: 'organic_publish' };
      continue;
    }

    if (!byUnit[unit] && current.metadata?.meta_ads_publish?.page_id && tokenId) {
      byUnit[unit] = {
        id: String(current.metadata.meta_ads_publish.page_id).trim(),
        tokenId,
        source: 'meta_ads_publish_page_id_fallback',
      };
    }
  }

  return byUnit;
}

function credentialReferences(payload) {
  const rawItems = [
    ...asArray(payload?.normalizedTokenVaultContext?.raw?.items),
    ...asArray(payload?.tokenVaultContext?.raw?.items),
  ];
  const refs = {};
  for (const value of rawItems) {
    const current = asObject(value);
    const platform = String(current.provider || '').trim().toLowerCase();
    const unit = normalizeUnit(current.unit || current.metadata?.legacy_columns?.Unit);
    const tokenId = String(current.token_id || current.id || '').trim();
    if (!platform || !unit || !tokenId) continue;
    refs[platform] ||= {};
    const isMetaAdsPublish =
      String(current.id || '').includes('meta_ads_publish') ||
      String(current.metadata?.purpose || '') === 'meta_ads_publish' ||
      Object.keys(asObject(current.metadata?.meta_ads_publish)).length > 0;
    if (platform === 'facebook' && isMetaAdsPublish && refs[platform][unit]) continue;
    refs[platform][unit] = {
      token_id: tokenId,
      external_account_id: String(current.external_account_id || '').trim(),
    };
  }
  return refs;
}

function scrubCredentialMaterial(value) {
  if (Array.isArray(value)) return value.map(scrubCredentialMaterial);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^OAuth\s+/i.test(value)) return undefined;
    return value;
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(access_token|token|fbToken|igToken|thToken|authorization|secret)$/i.test(key)) continue;
    const cleaned = scrubCredentialMaterial(entry);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function applyCredentialReference(job, refs) {
  const platform = String(job.platform || '').trim().toLowerCase();
  const unit = normalizeUnit(job.unit);
  const scrubbed = scrubCredentialMaterial(job);
  const credential = refs[platform]?.[unit];
  return credential ? { ...scrubbed, credential_ref: credential } : scrubbed;
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function cloudinaryVideoCoverUrl(videoUrl, timestampSeconds) {
  const source = String(videoUrl || '').trim();
  const seconds = asNumber(timestampSeconds, undefined);
  if (!isRemoteUrl(source) || seconds === undefined || !/\/video\/upload\//i.test(source)) return '';

  const rounded = Math.max(0, Math.round(seconds * 1000) / 1000)
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return source
    .replace('/video/upload/', `/video/upload/so_${rounded},f_jpg/`)
    .replace(/\.[a-z0-9]+(?:[?#].*)?$/i, '.jpg');
}

function asNumber(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectedTechnicalFrame(media) {
  const current = asObject(media);
  const bestFrame = asObject(current.bestFrame);
  const candidates = [
    ...asArray(bestFrame.candidateThumbs),
    ...asArray(bestFrame.candidates),
    ...asArray(current.frameCandidates),
    ...asArray(current.technicalFrameCandidates),
    ...asArray(current.candidateThumbs),
  ]
    .map((candidate) => asObject(candidate))
    .filter((candidate) => Object.keys(candidate).length)
    .sort((a, b) => {
      const rankA = asNumber(a.rank, Number.MAX_SAFE_INTEGER);
      const rankB = asNumber(b.rank, Number.MAX_SAFE_INTEGER);
      if (rankA !== rankB) return rankA - rankB;
      return asNumber(b.confidence, 0) - asNumber(a.confidence, 0);
    });
  const selected = candidates[0] || {};
  const selectedFrameUrl = String(
    bestFrame.selectedFrameUrl ||
    selected.url ||
    selected.thumbPath ||
    bestFrame.thumbPath ||
    current.thumbPath ||
    '',
  ).trim();
  const bestFrameSeconds = asNumber(
    bestFrame.bestFrameSeconds ??
    bestFrame.bestTimestampSeconds ??
    selected.timestampSeconds,
    undefined,
  );

  return {
    selectedFrameUrl,
    bestFrameSeconds,
    selectedFrameRank: asNumber(bestFrame.selectedFrameRank ?? selected.rank, undefined),
    selectedFrameSource: String(bestFrame.selectedFrameSource || selected.source || 'process_media_asset'),
    confidence: asNumber(bestFrame.confidence ?? selected.confidence, undefined),
    candidateCount: candidates.length,
  };
}

function editorialOutputItems(payload) {
  const preferred = asArray(payload.normalizedLiviaOutput).length
    ? asArray(payload.normalizedLiviaOutput)
    : asArray(payload.liviaOutput);
  return preferred.flatMap((entry) => {
    const current = asObject(asObject(entry).json || entry);
    return asArray(current.items).map((item) => asObject(item));
  });
}

function editorialFrameMatchesTechnical(media, editorial) {
  const selection = asObject(asObject(editorial).bestFrame);
  const selectedUrl = String(selection.selectedFrameUrl || '').trim();
  const selectedRank = asNumber(selection.selectedFrameRank, undefined);
  const selectedSeconds = asNumber(selection.bestTimestampSeconds ?? selection.bestFrameSeconds, undefined);
  if (!selectedUrl && selectedRank === undefined && selectedSeconds === undefined) return false;
  const candidates = [
    ...asArray(asObject(media).bestFrame.candidates),
    ...asArray(asObject(media).frameCandidates),
    ...asArray(asObject(media).technicalFrameCandidates),
  ].map((candidate) => asObject(candidate));
  return candidates.some((candidate) => {
    const candidateUrls = [candidate.url, candidate.thumbPath].map((value) => String(value || '').trim()).filter(Boolean);
    if (selectedUrl && candidateUrls.includes(selectedUrl)) return true;
    if (selectedUrl) return false;
    const candidateRank = asNumber(candidate.rank, undefined);
    const candidateSeconds = asNumber(candidate.timestampSeconds, undefined);
    return selectedRank !== undefined && selectedSeconds !== undefined &&
      candidateRank === selectedRank && candidateSeconds !== undefined &&
      Math.abs(candidateSeconds - selectedSeconds) < 0.001;
  });
}

function technicalFrameContext(payload) {
  const rawEntries = [
    ...asArray(payload.normalizedCombinedMediaItems),
    ...asArray(payload.combinedMediaItems),
  ].map((entry) => asObject(entry));
  const entries = [];
  const seen = new Set();
  for (const current of rawEntries) {
    const key = [current.groupKey, current.groupOrder, current.id].map((value) => String(value || '').trim()).join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(current);
  }
  const editorialItems = editorialOutputItems(payload);
  const byGroup = {};
  for (const [index, current] of entries.entries()) {
    const groupKey = String(current.groupKey || current.id || '').trim();
    if (!groupKey || byGroup[groupKey]) continue;
    const frame = selectedTechnicalFrame(current);
    const editorial = editorialItems[index];
    if (editorialFrameMatchesTechnical(current, editorial)) {
      const selected = asObject(asObject(editorial).bestFrame);
      frame.selectedFrameUrl = String(selected.selectedFrameUrl || frame.selectedFrameUrl || '').trim();
      frame.bestFrameSeconds = asNumber(selected.bestTimestampSeconds ?? selected.bestFrameSeconds, frame.bestFrameSeconds);
      frame.selectedFrameRank = asNumber(selected.selectedFrameRank, frame.selectedFrameRank);
      frame.selectedFrameSource = 'editorial_verified';
      frame.confidence = asNumber(selected.confidence, frame.confidence);
    }
    if (frame.selectedFrameUrl || frame.bestFrameSeconds !== undefined) byGroup[groupKey] = frame;
  }
  return byGroup;
}

function dedupeHashtagArray(value) {
  const seen = new Set();
  return asArray(value)
    .map((entry) => String(entry || '').trim())
    .filter((entry) => {
      if (!entry) return false;
      const normalized = entry.startsWith('#') ? entry : `#${entry}`;
      const key = normalized.normalize('NFC').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => (entry.startsWith('#') ? entry : `#${entry}`));
}

function dedupeHashtagsInText(value) {
  if (typeof value !== 'string' || !value.includes('#')) return value;
  const seen = new Set();
  return value
    .replace(/#[\p{L}\p{N}_]+/gu, (tag) => {
      const key = tag.normalize('NFC').toLowerCase();
      if (seen.has(key)) return '';
      seen.add(key);
      return tag;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyCaptionHygiene(job) {
  const current = { ...job };
  const warningSet = new Set(asArray(current.warnings).map((entry) => String(entry)).filter(Boolean));

  const cleanTextFields = (value) => {
    const out = { ...asObject(value) };
    let changed = false;
    for (const key of ['caption', 'text', 'message']) {
      if (typeof out[key] !== 'string') continue;
      const cleaned = dedupeHashtagsInText(out[key]);
      if (cleaned !== out[key]) {
        out[key] = cleaned;
        changed = true;
      }
    }
    if (Array.isArray(out.hashtags)) {
      const cleaned = dedupeHashtagArray(out.hashtags);
      if (JSON.stringify(cleaned) !== JSON.stringify(out.hashtags)) {
        out.hashtags = cleaned;
        changed = true;
      }
    }
    if (changed) warningSet.add('duplicate_hashtags_deduped');
    return removeNulls(out);
  };

  if (current.text && typeof current.text === 'object') current.text = cleanTextFields(current.text);
  if (current.jsonRequest && typeof current.jsonRequest === 'object') current.jsonRequest = cleanTextFields(current.jsonRequest);
  current.warnings = [...warningSet];
  return current;
}

function applyTechnicalFrame(job, framesByGroup) {
  const current = { ...job };
  const frame = framesByGroup[String(current.groupKey || '').trim()];
  if (!frame) return current;

  const warningSet = new Set(asArray(current.warnings).map((entry) => String(entry)).filter(Boolean));
  const text = { ...asObject(current.text) };
  if (frame.selectedFrameUrl) text.selectedFrameUrl = frame.selectedFrameUrl;
  if (frame.bestFrameSeconds !== undefined) text.bestFrameSeconds = frame.bestFrameSeconds;
  text.frameAnalysisSummary = removeNulls({
    ...asObject(text.frameAnalysisSummary),
    candidateCount: frame.candidateCount,
    selectedSource: frame.selectedFrameSource,
    confidence: frame.confidence,
    technicalRank: frame.selectedFrameRank,
    technicalTimestampSeconds: frame.bestFrameSeconds,
  });
  current.text = removeNulls(text);

  if (current.jsonRequest && typeof current.jsonRequest === 'object') {
    const body = { ...current.jsonRequest };
    const platform = String(current.platform || '').toLowerCase();
    if (body.thumbnail_url && !isRemoteUrl(body.thumbnail_url)) {
      delete body.thumbnail_url;
      warningSet.add('thumbnail_url_removed_local_path');
    } else if (frame.selectedFrameUrl && isRemoteUrl(frame.selectedFrameUrl) && body.thumbnail_url) {
      body.thumbnail_url = frame.selectedFrameUrl;
    }

    if (platform === 'instagram' && String(body.media_type || '').toUpperCase() === 'REELS') {
      const media = asObject(current.media);
      const mainVideoUrl = String(media.finalUrl || media.secure_url || media.url || '').trim();
      const coverUrl = cloudinaryVideoCoverUrl(mainVideoUrl, frame.bestFrameSeconds);
      if (coverUrl) {
        body.cover_url = coverUrl;
        delete body.thumb_offset;
        text.coverUrl = coverUrl;
        text.coverStatus = 'requested';
      } else if (frame.bestFrameSeconds !== undefined) {
        body.thumb_offset = Math.max(0, Math.round(frame.bestFrameSeconds * 1000));
        text.coverStatus = 'requested_fallback';
      }
    }

    if (
      platform === 'facebook' &&
      String(current.step || '').toLowerCase() === 'reels_finish' &&
      text.title && !body.title
    ) {
      body.title = text.title;
    }

    current.jsonRequest = removeNulls(body);
    current.text = removeNulls(text);
  }

  current.warnings = [...warningSet];
  return current;
}

function applyPlatformAccessibilityContract(job) {
  const current = { ...job };
  const platform = String(current.platform || '').trim().toLowerCase();
  if (platform !== 'instagram' && platform !== 'threads') return current;

  const bodies = [
    asObject(current.jsonRequest),
    asObject(current.requestBody),
    asObject(asObject(current.httpRequest).body),
    asObject(asObject(current.httpRequest).json),
  ];
  const mediaSignals = [
    current.mediaKind,
    current.mediaType,
    current.media_type,
    asObject(current.media).mediaKind,
    ...bodies.map((body) => body.media_type),
  ].map((value) => String(value || '').toUpperCase()).join(' ');
  if (!mediaSignals.includes('VIDEO') && !mediaSignals.includes('REEL')) return current;

  const warningSet = new Set(asArray(current.warnings).map((entry) => String(entry)).filter(Boolean));
  let removed = false;
  const scrubAltText = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = { ...value };
    for (const key of ['alt_text', 'altText', 'alt_text_custom']) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        delete out[key];
        removed = true;
      }
    }
    return out;
  };

  current.jsonRequest = scrubAltText(current.jsonRequest);
  current.requestBody = scrubAltText(current.requestBody);
  if (current.httpRequest && typeof current.httpRequest === 'object') {
    current.httpRequest = {
      ...current.httpRequest,
      body: scrubAltText(current.httpRequest.body),
      json: scrubAltText(current.httpRequest.json),
    };
  }
  const text = { ...asObject(current.text) };
  text.accessibilityStatus = 'unsupported';
  text.accessibilityReason = `${platform}_video_alt_text_not_supported`;
  current.text = removeNulls(text);
  if (removed) warningSet.add(`alt_text_omitted_for_video:${platform}`);
  current.warnings = [...warningSet];
  return current;
}

function normalizeFacebookGraphUrl(value, warnings, credential) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || !/^https:\/\/graph\.facebook\.com\//i.test(raw)) return raw;

  const match = raw.match(/^(https:\/\/graph\.facebook\.com\/v\d+(?:\.\d+)?\/)([^/?#]+)(.*)$/i);
  if (!match) return raw;

  const [, prefix, objectId, suffix] = match;
  const stableObjectId = String(credential?.id || '').trim() || objectId.split(':')[0].trim();
  if (!stableObjectId || stableObjectId === objectId) return raw;

  const normalized = `${prefix}${stableObjectId}${suffix}`;
  if (normalized !== raw) {
    warnings.add(objectId.includes(':')
      ? `facebook_account_id_slug_stripped:${objectId}`
      : `facebook_account_id_rewritten:${objectId}`);
  }
  return normalized;
}

function normalizeGraphApiVersion(value) {
  return String(value || '')
    .replace(/https:\/\/graph\.facebook\.com\/v\d+(?:\.\d+)?/gi, 'https://graph.facebook.com/v25.0')
    .replace(/https:\/\/graph\.instagram\.com\/v\d+(?:\.\d+)?/gi, 'https://graph.instagram.com/v25.0');
}

function normalizeGraphApiVersionJob(job) {
  const current = { ...job };
  current.url = normalizeGraphApiVersion(current.url);
  if (current.httpRequest && typeof current.httpRequest === 'object') {
    current.httpRequest = { ...current.httpRequest, url: normalizeGraphApiVersion(current.httpRequest.url) };
  }
  return current;
}

function normalizeFacebookJob(job, credentialsByUnit) {
  const current = { ...job };
  if (String(current.platform || '').toLowerCase() !== 'facebook') return current;

  const warningSet = new Set(asArray(current.warnings).map((entry) => String(entry)).filter(Boolean));
  const credential = credentialsByUnit[normalizeUnit(current.unit)] || null;
  if (credential?.source) warningSet.add(`facebook_account_resolved_from:${credential.source}`);

  current.url = normalizeFacebookGraphUrl(current.url, warningSet, credential);
  if (current.httpRequest && typeof current.httpRequest === 'object') {
    current.httpRequest = {
      ...current.httpRequest,
      url: normalizeFacebookGraphUrl(current.httpRequest.url, warningSet, credential),
    };
  }
  current.warnings = [...warningSet];
  return current;
}

function normalizeThreadsCarouselJob(job) {
  const current = { ...job };
  if (String(current.platform || '').trim().toLowerCase() !== 'threads') return current;

  const phase = String(current.phase || '').trim().toLowerCase();
  const request = { ...asObject(current.jsonRequest) };
  const carouselChild = phase === 'upload'
    && (request.is_carousel_item === true || String(request.is_carousel_item || '').trim().toLowerCase() === 'true');

  if (carouselChild) {
    // Threads requires the concrete media type for every child. CAROUSEL is
    // accepted only by the parent container that references these children.
    request.media_type = 'IMAGE';
  }
  if (phase === 'uploadcontainer') request.media_type = 'CAROUSEL';
  current.jsonRequest = request;
  return current;
}

function resumeContextKey(job) {
  const current = asObject(job);
  const media = asObject(current.media);
  const groupKey = String(current.groupKey || '').trim();
  const mediaId = String(media.id || current.mediaId || '').trim();
  if (!groupKey || !mediaId) return '';
  return crypto.createHash('sha256').update(`${groupKey}\n${mediaId}`).digest('hex');
}

function groupResumeContextKey(groupKey) {
  const currentGroupKey = String(groupKey || '').trim();
  if (!currentGroupKey) return '';
  return crypto.createHash('sha256').update(`${currentGroupKey}\n__group__`).digest('hex');
}

function isInstagramCarouselJob(job) {
  const current = asObject(job);
  const media = asObject(current.media);
  return String(current.platform || '').trim().toLowerCase() === 'instagram'
    && (String(current.phase || '').trim().toLowerCase() === 'uploadcontainer'
      || Number(media.quantity || current.quantity || 0) > 1
      || current.is_carousel_item === true
      || String(current.is_carousel_item || '').trim().toLowerCase() === 'true');
}

function carouselScope(row) {
  const current = asObject(row);
  return [
    String(current.groupKey || '').trim(),
    normalizeUnit(current.unit),
    String(current.platform || '').trim().toLowerCase(),
  ].join('\n');
}

function invalidateIncompleteCarouselResume(jobs, completed) {
  const carouselScopes = new Set(
    jobs
      .filter(isInstagramCarouselJob)
      .map(carouselScope)
      .filter(Boolean),
  );
  if (!carouselScopes.size) return { completed, invalidatedScopes: [] };

  const rowsByScope = new Map();
  for (const row of completed) {
    const scope = carouselScope(row);
    if (!carouselScopes.has(scope)) continue;
    const rows = rowsByScope.get(scope) || [];
    rows.push(asObject(row));
    rowsByScope.set(scope, rows);
  }

  const invalidatedScopes = [...rowsByScope.entries()]
    .filter(([, rows]) => {
      const hasContainer = rows.some((row) => String(row.phase || '').trim().toLowerCase() === 'uploadcontainer');
      const hasPublishedPost = rows.some((row) => String(row.phase || '').trim().toLowerCase() === 'publish');
      return hasContainer && !hasPublishedPost;
    })
    .map(([scope]) => scope);
  if (!invalidatedScopes.length) return { completed, invalidatedScopes };

  const blocked = new Set(invalidatedScopes);
  return {
    completed: completed.filter((row) => !blocked.has(carouselScope(row))),
    invalidatedScopes,
  };
}

function loadResumeCompleted(jobs) {
  const completed = [];
  const seen = new Set();
  for (const job of jobs) {
    const keys = [resumeContextKey(job), groupResumeContextKey(job.groupKey)].filter(Boolean);
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const filePath = path.join(LEDGER_DIR, `${key}.json`);
      if (!fs.existsSync(filePath)) continue;
      let ledger;
      try {
        ledger = readJson(filePath);
      } catch (error) {
        fail(`Unable to read Livia publish progress ledger ${filePath}: ${error.message}`);
      }
      const rows = asArray(ledger.completed)
        .map((entry) => asObject(entry))
        .filter((entry) => Number.isInteger(Number(entry.publishRunIndex)) && Object.keys(asObject(entry.lastResponseBody)).length);
      completed.push(...rows);
    }
  }
  const byRun = new Map();
  for (const row of completed) byRun.set(Number(row.publishRunIndex), row);
  return invalidateIncompleteCarouselResume(
    jobs,
    [...byRun.values()].sort((left, right) => Number(left.publishRunIndex) - Number(right.publishRunIndex)),
  );
}

function normalizeExternalResult(result) {
  const jsonItems = asArray(result)
    .map((entry) => asObject(asObject(entry).json))
    .filter((entry) => Object.keys(entry).length);

  // compose2-current.js returns direct n8n items, while older builders return
  // one envelope containing `jobs`. Accept only those two explicit contracts.
  if (jsonItems.length === 1 && Array.isArray(jsonItems[0].jobs)) return jsonItems[0];
  if (jsonItems.some((entry) => Array.isArray(entry.jobs))) {
    fail(`${NODE_NAME}: mixed or multiple job envelopes are not supported.`);
  }

  const directJobs = jsonItems.filter((entry) => (
    String(entry.platform || '').trim() &&
    String(entry.phase || '').trim() &&
    String(entry.method || '').trim() &&
    String(entry.url || '').trim()
  ));
  if (directJobs.length === jsonItems.length && directJobs.length) {
    return { jobs: directJobs, warnings: ['external_source_direct_job_items'] };
  }

  fail(`${NODE_NAME}: unsupported external job contract; expected one jobs envelope or direct n8n job items.`);
}

function assertOutputContract() {
  const job = { platform: 'instagram', phase: 'upload', method: 'POST', url: 'https://example.invalid/media' };
  const direct = normalizeExternalResult([{ json: job }]);
  const enveloped = normalizeExternalResult([{ json: { jobs: [job] } }]);
  if (direct.jobs.length !== 1 || enveloped.jobs.length !== 1) {
    fail(`${NODE_NAME}: external output-contract assertion failed.`);
  }
  return { directItems: direct.jobs.length, envelopedItems: enveloped.jobs.length };
}

function normalizeFacebookReelsChecks(jobs) {
  const expanded = [];
  for (const job of jobs) {
    const current = { ...job, __sourceRunIndex: Number(job.publishRunIndex) };
    if (String(current.platform || '').toLowerCase() === 'facebook' &&
        String(current.phase || '').toLowerCase() === 'checkstatus' &&
        String(current.checkKind || '').toLowerCase() === 'fb_reels_video') {
      current.checkKind = 'fb_reels_upload_ready';
    }
    expanded.push(current);
    if (String(current.platform || '').toLowerCase() !== 'facebook' || String(current.step || '').toLowerCase() !== 'reels_finish') continue;
    const uploadReady = [...expanded].reverse().find((candidate) =>
      String(candidate.platform || '').toLowerCase() === 'facebook' &&
      String(candidate.groupKey || '') === String(current.groupKey || '') &&
      String(candidate.unit || '') === String(current.unit || '') &&
      String(candidate.checkKind || '').toLowerCase() === 'fb_reels_upload_ready');
    if (!uploadReady) fail(`${NODE_NAME}: Facebook Reel finish without an upload-ready check.`);
    expanded.push({
      ...uploadReady,
      __sourceRunIndex: undefined,
      checkKind: 'fb_reels_published',
      checkFields: 'status',
      statusFromPublishRunIndex: current.reelsStartFromPublishRunIndex ?? uploadReady.statusFromPublishRunIndex,
      postPublishFromRunIndex: current.__sourceRunIndex,
      warnings: [...asArray(uploadReady.warnings), 'fb_reels_post_publish_check'],
    });
  }
  const remap = new Map();
  expanded.forEach((job, index) => { if (Number.isFinite(job.__sourceRunIndex)) remap.set(job.__sourceRunIndex, index); job.publishRunIndex = index; });
  const refs = ['statusFromPublishRunIndex', 'postPublishFromRunIndex', 'checkStatusFromPublishRunIndex', 'creationIdFromPublishRunIndex', 'lastUploadFromPublishRunIndex', 'reelsStartFromPublishRunIndex'];
  for (const job of expanded) {
    for (const key of refs) if (Number.isFinite(Number(job[key])) && remap.has(Number(job[key]))) job[key] = remap.get(Number(job[key]));
    if (Array.isArray(job.attachedMediaFromPublishRunIndexes)) job.attachedMediaFromPublishRunIndexes = job.attachedMediaFromPublishRunIndexes.map((value) => remap.has(Number(value)) ? remap.get(Number(value)) : value);
    delete job.__sourceRunIndex;
  }
  return expanded;
}

function assertPlatformContracts() {
  const frames = technicalFrameContext({
    normalizedCombinedMediaItems: [{
      id: 'fixture-video',
      groupKey: 'fixture-video',
      groupOrder: 0,
      bestFrame: { candidates: [{ rank: 2, timestampSeconds: 4, url: 'https://example.invalid/frame.jpg' }] },
    }],
    normalizedLiviaOutput: [{
      items: [{
        bestFrame: {
          selectedFrameRank: 2,
          bestTimestampSeconds: 4,
          selectedFrameUrl: 'https://example.invalid/frame.jpg',
          confidence: 0.91,
        },
      }],
    }],
  });
  if (frames['fixture-video']?.selectedFrameSource !== 'editorial_verified') {
    fail(`${NODE_NAME}: editorial frame-correlation assertion failed.`);
  }

  const facebookJobs = normalizeFacebookReelsChecks([
    {
      publishRunIndex: 0,
      platform: 'facebook',
      phase: 'checkStatus',
      checkKind: 'fb_reels_video',
      groupKey: 'fixture-video',
      unit: 'bss',
    },
    {
      publishRunIndex: 1,
      platform: 'facebook',
      phase: 'publish',
      step: 'reels_finish',
      groupKey: 'fixture-video',
      unit: 'bss',
      reelsStartFromPublishRunIndex: 0,
    },
  ]);
  const ready = facebookJobs.filter((job) => job.checkKind === 'fb_reels_upload_ready');
  const published = facebookJobs.filter((job) => job.checkKind === 'fb_reels_published');
  if (ready.length !== 1 || published.length !== 1 || published[0].statusFromPublishRunIndex !== 0 || published[0].postPublishFromRunIndex !== 1) {
    fail(`${NODE_NAME}: Facebook Reels post-publication assertion failed.`);
  }
  return { editorialFrame: true, facebookReelsChecks: facebookJobs.length };
}

function compactResult(result, payload, sourceFile) {
  const firstJson = normalizeExternalResult(result);
  const facebookCredentials = facebookCredentialContext(payload);
  const credentialRefs = credentialReferences(payload);
  const frameContext = technicalFrameContext(payload);
  const jobs = normalizeFacebookReelsChecks(asArray(firstJson.jobs)
    .map((entry) => asObject(entry))
    .map((entry) => applyCaptionHygiene(entry))
    .map((entry) => applyTechnicalFrame(entry, frameContext))
    .map((entry) => applyPlatformAccessibilityContract(entry))
    .map((entry) => normalizeGraphApiVersionJob(entry))
    .map((entry) => normalizeFacebookJob(entry, facebookCredentials))
    .map((entry) => normalizeThreadsCarouselJob(entry))
    .map((entry) => applyCredentialReference(entry, credentialRefs))
    .filter((entry) => Object.keys(entry).length));
  if (!jobs.length) fail(`${NODE_NAME}: external source did not produce jobs.`);
  const resume = loadResumeCompleted(jobs);
  const resumeCompleted = resume.completed;

  const jobKinds = asArray(firstJson.jobKinds).length
    ? asArray(firstJson.jobKinds)
    : [...new Set(jobs.map((job) => [job.platform, job.phase, job.step].filter(Boolean).join(':')).filter(Boolean))];

  return removeNulls({
    jobs,
    jobCount: jobs.length,
    resumeCompleted,
    resumePendingJobCount: Math.max(0, jobs.length - resumeCompleted.length),
    jobKinds,
    platformSummary: Object.keys(asObject(firstJson.platformSummary)).length
      ? asObject(firstJson.platformSummary)
      : summarizePlatform(jobs),
    warnings: [
      ...asArray(firstJson.warnings || payload.warnings),
      ...resume.invalidatedScopes.map((scope) => `carousel_resume_invalidated:${scope.replace(/\n/g, ':')}`),
    ].slice(0, 80),
    codexPayloadCompacted: true,
    debug: {
      ...asObject(firstJson.debug),
      sourceNode: NODE_NAME,
      jobCount: jobs.length,
      resumeCompletedCount: resumeCompleted.length,
      invalidatedCarouselResumeScopes: resume.invalidatedScopes,
      implementation: 'scripts/livia/build-platform-job-graph.js',
      externalizedSource: path.relative(MODULE_ROOT, sourceFile).replace(/\\/g, '/'),
      droppedPayloadKeys: ['bootstrapItems', 'normalizedLiviaOutput', 'normalizedCombinedMediaItems', 'normalizedTokenVaultContext', 'publishContexts'],
    },
  });
}

function main() {
  const source = loadSource();
  if (process.argv.includes('--assert-runtime-compatibility')) {
    process.stdout.write(JSON.stringify({
      ok: true,
      sourceFile: source.filePath,
      compatibility: assertRuntimeCompatibility(source.jsCode),
    }));
    return;
  }
  if (process.argv.includes('--assert-output-contract')) {
    process.stdout.write(JSON.stringify({ ok: true, outputContract: assertOutputContract() }));
    return;
  }
  if (process.argv.includes('--assert-platform-contracts')) {
    process.stdout.write(JSON.stringify({ ok: true, platformContracts: assertPlatformContracts() }));
    return;
  }
  const payload = parsePayload();
  const result = executeSource(source.jsCode, payload);
  process.stdout.write(JSON.stringify(compactResult(result, payload, source.filePath)));
}

main();
