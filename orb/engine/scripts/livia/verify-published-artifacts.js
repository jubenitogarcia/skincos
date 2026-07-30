#!/usr/bin/env node

'use strict';

const fs = require('fs');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function readPayload() {
  const payload = argValue('--payload');
  const raw = argValue('--payload-file')
    ? fs.readFileSync(argValue('--payload-file'), 'utf8')
    : payload === '-'
      ? fs.readFileSync(0, 'utf8')
      : payload;
  const normalized = String(raw || '').replace(/^\uFEFF/, '');
  if (!normalized.trim()) throw new Error('Missing --payload for published-artifact verification.');
  return JSON.parse(normalized);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeUnit(value) {
  const normalized = str(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'bss' || normalized === 'barrashoppingsul') return 'bss';
  if (normalized === 'nh' || normalized === 'novohamburgo') return 'nh';
  return normalized;
}

async function gatewayRequest(target) {
  const baseUrl = str(process.env.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault').replace(/\/+$/, '');
  const bearer = str(process.env.TOKEN_VAULT_N8N_API_TOKEN);
  if (!bearer) return { statusCode: 0, body: { error: 'gateway_credential_missing' } };
  const provider = providerRequest(target);
  const response = await fetch(`${baseUrl}/v1/social-publish/operations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'user-agent': 'skincos-livia-verifier/2.0',
    },
    body: JSON.stringify({
      platform: str(target.platform).toLowerCase(),
      unit: normalizeUnit(target.unit),
      operation: 'verify_published_artifact',
      method: 'GET',
      url: provider.url.toString(),
      query: { fields: provider.fields },
    }),
    signal: AbortSignal.timeout(20000),
  }).catch((error) => ({ ok: false, status: 0, json: async () => ({ error: error.message }) }));
  return { statusCode: response.status || 0, body: await response.json().catch(() => ({})) };
}

function exactText(actual, expected) {
  return str(actual).replace(/\r\n/g, '\n') === str(expected).replace(/\r\n/g, '\n');
}

function publicFacebookPermalink(value) {
  const raw = str(value);
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw;
  return `https://www.facebook.com${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function expectedMediaKind(target) {
  const raw = str(target.mediaKind).toLowerCase();
  if (raw.includes('carousel')) return 'carousel';
  if (raw.includes('video') || raw.includes('reel')) return 'video';
  if (raw.includes('image') || raw.includes('photo')) return 'image';
  return '';
}

function facebookStaticPost(target) {
  return str(target.platform).toLowerCase() === 'facebook' &&
    str(target.publishMode).toLowerCase() !== 'reels' &&
    expectedMediaKind(target) !== 'video';
}

function facebookCompositePost(target) {
  return facebookStaticPost(target) &&
    /^\d+_\d+$/.test(str(target.providerObjectId)) &&
    /^\d+$/.test(str(target.providerMediaId));
}

function facebookPhotoObject(target) {
  return facebookStaticPost(target) && (facebookCompositePost(target) ||
    (str(target.providerObjectId) && str(target.providerObjectId) === str(target.providerMediaId)));
}

function facebookReadObjectId(target) {
  // A composite Page post must be read as the post itself, not as one chosen
  // attachment. Reading only the first photo/video made it impossible to
  // detect a provider that accepted the post but omitted a later carousel
  // child. The gateway permits this tightly-scoped pageId_postId GET path.
  return str(target.providerObjectId);
}

function facebookCompositePermalink(target) {
  const [pageId, postId] = str(target.providerObjectId).split('_');
  return pageId && postId ? `https://www.facebook.com/${pageId}/posts/${postId}` : '';
}

function mediaTypeMatches(expected, actual) {
  const current = str(actual).toUpperCase();
  if (!expected || !current) return true;
  if (expected === 'image') return current === 'IMAGE';
  if (expected === 'video') return current === 'VIDEO' || current === 'REELS';
  if (expected === 'carousel') return current === 'CAROUSEL' || current === 'CAROUSEL_ALBUM';
  return false;
}

function compactProviderBody(platform, body) {
  const source = asObject(body);
  if (platform === 'facebook') {
    return {
      id: source.id,
      permalink_url: source.permalink_url,
      description: source.description,
      message: source.message,
      title: source.title,
      published: source.published,
      status: source.status,
      created_time: source.created_time,
      full_picture: source.full_picture,
      attachments: compactFacebookAttachments(source.attachments),
    };
  }
  if (platform === 'instagram') {
    return {
      id: source.id,
      permalink: source.permalink,
      media_type: source.media_type,
      caption: source.caption,
      thumbnail_url: source.thumbnail_url,
      timestamp: source.timestamp,
    };
  }
  return {
    id: source.id,
    permalink: source.permalink,
    media_type: source.media_type,
    text: source.text,
    timestamp: source.timestamp,
  };
}

function compactFacebookAttachments(value) {
  const data = asArray(asObject(value).data);
  const compact = (entry) => {
    const current = asObject(entry);
    return {
      media_type: current.media_type,
      target: asObject(current.target).id,
      media: asObject(current.media).id,
      subattachments: asArray(asObject(current.subattachments).data).map(compact),
    };
  };
  return data.map(compact);
}

function providerRequest(target) {
  const platform = str(target.platform).toLowerCase();
  const objectId = platform === 'facebook'
    ? facebookReadObjectId(target)
    : str(target.providerObjectId);
  const url = new URL(
    platform === 'instagram'
      ? `https://graph.instagram.com/v25.0/${objectId}`
      : platform === 'facebook'
        ? `https://graph.facebook.com/v25.0/${objectId}`
        : `https://graph.threads.net/v1.0/${objectId}`,
  );
  const fields = platform === 'instagram'
    ? 'id,permalink,media_type,caption,timestamp,thumbnail_url'
    : platform === 'facebook'
      ? facebookCompositePost(target)
        ? 'id,permalink_url,message,created_time,attachments{media_type,media,target,subattachments{media_type,media,target}},from'
        : facebookStaticPost(target)
          ? facebookPhotoObject(target)
            ? 'id,link,name,created_time,images,from'
            : 'id,permalink_url,message,created_time,full_picture,from'
        : 'id,permalink_url,description,title,created_time,status,published,from'
      : 'id,permalink,media_type,text,timestamp';
  return { url, fields };
}

function expectedAccessibilitySupport(platform, mediaKind) {
  if (platform === 'facebook') return 'unsupported';
  if (platform === 'instagram' && mediaKind === 'video') return 'unsupported';
  if ((platform === 'instagram' || platform === 'threads') && (mediaKind === 'image' || mediaKind === 'video')) return 'required';
  return 'unsupported';
}

function assessAccessibilityContract(target) {
  const platform = str(target.platform).toLowerCase();
  const contract = asObject(target.accessibilityContract);
  const items = asArray(contract.items).map((entry) => asObject(entry));
  if (contract.schema !== 'livia.media-alt-text.v1' || contract.orderedBy !== 'groupOrder' || !items.length) {
    return { status: 'failed', reason: 'accessibility_contract_missing_or_invalid' };
  }

  const semanticKeys = new Set();
  const sourceKeys = new Set();
  let requiredCount = 0;
  let submittedRequiredCount = 0;
  let unsupportedCount = 0;
  for (const item of items) {
    const sourceMediaId = str(item.sourceMediaId);
    const semanticJobKey = str(item.semanticJobKey);
    const mediaKind = str(item.mediaKind).toLowerCase();
    const support = str(item.support).toLowerCase();
    const expectedAltText = str(item.expectedAltText);
    const submittedAltText = str(item.submittedAltText);
    const groupOrder = Number(item.groupOrder);
    if (!sourceMediaId || !semanticJobKey || !Number.isInteger(groupOrder) || groupOrder < 0 || !['image', 'video'].includes(mediaKind)) {
      return { status: 'failed', reason: 'accessibility_item_identity_invalid' };
    }
    if (semanticKeys.has(semanticJobKey) || sourceKeys.has(`${sourceMediaId}|${groupOrder}`)) {
      return { status: 'failed', reason: 'accessibility_item_identity_duplicate' };
    }
    semanticKeys.add(semanticJobKey);
    sourceKeys.add(`${sourceMediaId}|${groupOrder}`);
    const expectedSupport = expectedAccessibilitySupport(platform, mediaKind);
    if (support !== expectedSupport) {
      return { status: 'failed', reason: 'accessibility_support_mismatch' };
    }
    if (support === 'required') {
      requiredCount += 1;
      if (!expectedAltText || !submittedAltText || expectedAltText !== submittedAltText) {
        return { status: 'failed', reason: 'alt_text_not_submitted_or_mismatched' };
      }
      submittedRequiredCount += 1;
    } else {
      unsupportedCount += 1;
      if (submittedAltText) return { status: 'failed', reason: 'alt_text_submitted_to_unsupported_media' };
    }
  }

  if (Number(contract.requiredCount) !== requiredCount ||
      Number(contract.submittedRequiredCount) !== submittedRequiredCount ||
      Number(contract.unsupportedCount) !== unsupportedCount) {
    return { status: 'failed', reason: 'accessibility_contract_count_mismatch' };
  }
  return requiredCount
    ? { status: 'accepted', reason: 'submitted_to_provider_but_not_readable_from_public_object', requiredCount, submittedRequiredCount, unsupportedCount }
    : { status: 'unsupported', reason: `${platform}_media_alt_text_not_supported_in_current_flow`, requiredCount, submittedRequiredCount, unsupportedCount };
}

function orderedMediaEvidence(target) {
  const contract = asObject(target.mediaEvidenceContract);
  const items = asArray(contract.items).map((entry) => asObject(entry));
  if (contract.schema !== 'livia.media-evidence.v1' || contract.orderedBy !== 'groupOrder' || !items.length) {
    return { status: 'failed', reason: 'media_evidence_contract_missing_or_invalid', items: [] };
  }
  const seenSemanticKeys = new Set();
  const seenSourceKeys = new Set();
  let previousOrder = -1;
  for (const item of items) {
    const sourceMediaId = str(item.sourceMediaId);
    const semanticJobKey = str(item.semanticJobKey);
    const providerMediaId = str(item.providerMediaId);
    const mediaKind = str(item.mediaKind).toLowerCase();
    const groupOrder = Number(item.groupOrder);
    if (!sourceMediaId || !semanticJobKey || !providerMediaId || !Number.isInteger(groupOrder) || groupOrder < 0 || !['image', 'video'].includes(mediaKind)) {
      return { status: 'failed', reason: 'media_evidence_item_identity_invalid', items: [] };
    }
    if (seenSemanticKeys.has(semanticJobKey) || seenSourceKeys.has(`${sourceMediaId}|${groupOrder}`) || groupOrder < previousOrder) {
      return { status: 'failed', reason: 'media_evidence_order_or_identity_invalid', items: [] };
    }
    seenSemanticKeys.add(semanticJobKey);
    seenSourceKeys.add(`${sourceMediaId}|${groupOrder}`);
    previousOrder = groupOrder;
  }
  return { status: 'accepted', reason: 'ordered_semantic_media_evidence', items };
}

function facebookAttachmentIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) facebookAttachmentIds(entry, output);
    return output;
  }
  const current = asObject(value);
  if (!Object.keys(current).length) return output;
  for (const candidate of [asObject(current.target).id, asObject(current.media).id]) {
    const id = str(candidate);
    if (id) output.add(id);
  }
  facebookAttachmentIds(asObject(current.subattachments).data, output);
  return output;
}

function assessMediaEvidence(target, body) {
  const contract = orderedMediaEvidence(target);
  if (contract.status !== 'accepted') return contract;
  if (!facebookCompositePost(target)) return contract;

  const attachmentIds = facebookAttachmentIds(asObject(asObject(body).attachments).data);
  if (!attachmentIds.size) {
    return { status: 'failed', reason: 'facebook_composite_attachments_missing', items: contract.items };
  }
  const missing = contract.items
    .map((item) => str(item.providerMediaId))
    .filter((id) => !attachmentIds.has(id));
  if (missing.length) {
    return {
      status: 'failed',
      reason: 'facebook_composite_attachment_identity_missing',
      items: contract.items,
      missingProviderMediaIds: missing,
    };
  }
  return {
    status: 'accepted',
    reason: 'facebook_composite_attachments_match_ordered_media_evidence',
    items: contract.items,
    attachmentIds: [...attachmentIds],
  };
}

function buildDelivery(target, response) {
  const platform = str(target.platform).toLowerCase();
  const body = asObject(response.body);
  const expected = asObject(target.expected);
  const submitted = asObject(target.submitted);
  const mediaKind = expectedMediaKind(target);
  const staticFacebook = facebookStaticPost(target);
  const compositeFacebook = facebookCompositePost(target);
  const errors = [];
  const permalink = platform === 'facebook'
    ? compositeFacebook
      ? facebookCompositePermalink(target)
      : publicFacebookPermalink(body.permalink_url || body.link)
    : str(body.permalink);
  const caption = platform === 'facebook'
    ? staticFacebook ? body.message || body.name : body.description
    : platform === 'threads' ? body.text : body.caption;
  const mediaType = str(body.media_type).toUpperCase();
  const facebookStatus = asObject(body.status);
  const facebookPublished = staticFacebook ? response.statusCode === 200 && Boolean(permalink) : body.published === true &&
    str(asObject(facebookStatus.publishing_phase).publish_status).toLowerCase() === 'published';
  const expectedFacebookPageId = compositeFacebook ? str(target.providerObjectId).split('_')[0] : '';
  const captionReadable = true;

  if (response.statusCode !== 200) errors.push(`provider_read_failed:${response.statusCode}`);
  if (!permalink) errors.push('public_permalink_missing');
  if (platform === 'facebook' && !facebookPublished) errors.push('facebook_not_published');
  if (expectedFacebookPageId && str(asObject(body.from).id) !== expectedFacebookPageId) {
    errors.push('facebook_page_mismatch');
  }
  if (platform !== 'facebook' && !mediaTypeMatches(mediaKind, mediaType)) {
    errors.push(`unexpected_media_type:${mediaType || 'missing'}:expected_${mediaKind || 'unknown'}`);
  }
  if (captionReadable && !exactText(caption, expected.caption)) errors.push('caption_mismatch');

  const accessibility = assessAccessibilityContract(target);
  const mediaEvidence = assessMediaEvidence(target, body);
  const title = { status: 'unsupported', reason: `${platform}_${mediaKind || 'media'}_has_no_public_title_contract` };
  const cover = mediaKind !== 'video'
    ? { status: 'unsupported', reason: 'not_applicable_for_static_image' }
    : platform === 'instagram'
    ? submitted.coverUrl || Number.isFinite(Number(submitted.thumbOffset))
      ? str(body.thumbnail_url)
        ? { status: 'accepted', requested: submitted.coverUrl ? 'cover_url' : 'thumb_offset', thumbnailUrl: str(body.thumbnail_url) }
        : { status: 'failed', reason: 'instagram_thumbnail_missing' }
      : { status: 'failed', reason: 'cover_not_requested' }
    : { status: 'unsupported', reason: `${platform}_video_cover_not_configurable_in_this_flow` };

  if (accessibility.status === 'failed') errors.push(`accessibility_failed:${str(accessibility.reason) || 'unknown'}`);
  if (mediaEvidence.status === 'failed') errors.push(`media_evidence_failed:${str(mediaEvidence.reason) || 'unknown'}`);
  if (cover.status === 'failed') errors.push(`cover_failed:${str(cover.reason) || 'unknown'}`);

  return {
    platform,
    unit: normalizeUnit(target.unit),
    mediaKind: compositeFacebook ? 'carousel' : mediaKind,
    publishMode: str(target.publishMode).toLowerCase(),
    providerObjectId: str(target.providerObjectId),
    providerMediaId: str(target.providerMediaId),
    state: errors.length ? 'failed' : 'verified',
    permalink,
    content: {
      caption: captionReadable
        ? exactText(caption, expected.caption) ? 'verified' : 'failed'
        : 'accepted',
      title,
      accessibility,
      mediaEvidence,
      cover,
    },
    verificationNotes: compositeFacebook
      ? ['facebook_carousel_post_confirmed_by_public_post_readback_and_ordered_attachment_contract']
      : [],
    errors,
    provider: compactProviderBody(platform, body),
  };
}

function renderMessage(final, deliveries) {
  const byKey = new Map(deliveries.map((entry) => [`${entry.platform}:${entry.unit}`, entry]));
  const rows = ['✅ Publicação verificada', ''];
  for (const [unit, label] of [['bss', 'BarraShoppingSul'], ['nh', 'Novo Hamburgo']]) {
    rows.push(`*${label}*`);
    for (const [platform, icon] of [['instagram', '📷'], ['facebook', '🔵'], ['threads', '🧵']]) {
      rows.push(`- ${icon} ${byKey.get(`${platform}:${unit}`)?.permalink || 'pendente'}`);
    }
    rows.push('');
  }
  const copy = asObject(final.whatsapp);
  for (const [platform, label] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['threads', 'Threads']]) {
    const entry = asObject(copy[platform]);
    rows.push(`*${label}*`);
    rows.push(`🏷️ ${str(entry.title) || 'sem título'}`);
    rows.push(`🖼️ ${str(entry.altText) || 'sem alt text'}`);
    rows.push(`#️⃣ ${asArray(entry.hashtags).join(' ') || 'sem hashtags'}`);
    rows.push(`📝 ${str(entry.captionClean || entry.caption) || 'sem legenda'}`);
    rows.push('');
  }
  return rows.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const payload = readPayload();
  const final = asObject(payload.final);
  if (final.codexDryRun === true) {
    console.log(JSON.stringify({
      ok: true,
      final: { ...final, deliveryAudit: { state: 'simulated', targets: [] } },
      deliveryAudit: { state: 'simulated', targets: [] },
    }));
    return;
  }

  const targets = asArray(asObject(final.publishVerification).targets);
  if (!targets.length) throw new Error('No publication verification targets were provided.');
  const deliveries = [];
  for (const target of targets) {
    const platform = str(target.platform).toLowerCase();
    const unit = normalizeUnit(target.unit);
    const response = await gatewayRequest(target);
    deliveries.push(buildDelivery(target, response));
  }

  const failures = deliveries.filter((entry) => entry.state !== 'verified');
  const whatsapp = { ...asObject(final.whatsapp) };
  for (const entry of deliveries) {
    if (!whatsapp[entry.platform]) continue;
    whatsapp[entry.platform] = { ...asObject(whatsapp[entry.platform]) };
    whatsapp[entry.platform].permalinks = {
      ...asObject(whatsapp[entry.platform].permalinks),
      [entry.unit]: entry.permalink || '',
    };
  }
  const verifiedFinal = {
    ...final,
    whatsapp,
    whatsappAlerts: failures.map((entry) => `${entry.platform} ${String(entry.unit || '').toUpperCase()}: ${asArray(entry.errors).join(', ')}`),
    deliveryAudit: {
      state: failures.length ? 'failed' : 'verified',
      targets: deliveries,
    },
  };
  verifiedFinal.whatsappMessage = renderMessage(verifiedFinal, deliveries);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    final: verifiedFinal,
    deliveryAudit: verifiedFinal.deliveryAudit,
  }));
  if (failures.length) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  assessAccessibilityContract,
  assessMediaEvidence,
  buildDelivery,
  expectedAccessibilitySupport,
  facebookAttachmentIds,
  orderedMediaEvidence,
};
