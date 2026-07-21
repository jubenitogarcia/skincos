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
  // The token-vault only permits numeric Graph object IDs. For a feed post in
  // pageId_postId form, validate the attached public photo and keep the post
  // permalink as a separate, deterministic public URL.
  return facebookCompositePost(target)
    ? str(target.providerMediaId)
    : str(target.providerObjectId);
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
      ? facebookStaticPost(target)
        ? facebookPhotoObject(target)
          ? 'id,link,name,created_time,images,from'
          : 'id,permalink_url,message,created_time,full_picture,from'
        : 'id,permalink_url,description,title,created_time,status,published,from'
      : 'id,permalink,media_type,text,timestamp';
  return { url, fields };
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
  const captionReadable = !(platform === 'facebook' && compositeFacebook);

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

  const accessibility = platform === 'facebook'
    ? { status: 'unsupported', reason: staticFacebook
      ? 'facebook_static_post_alt_text_not_available_in_current_flow'
      : 'facebook_reels_api_does_not_receive_alt_text_in_this_flow' }
    : mediaKind === 'video'
      ? { status: 'unsupported', reason: `${platform}_video_alt_text_not_supported` }
    : submitted.altText
      ? { status: 'accepted', reason: 'submitted_to_provider_but_not_readable_from_public_object' }
      : { status: 'failed', reason: 'alt_text_not_submitted' };
  const title = platform === 'instagram' || platform === 'threads' || staticFacebook
    ? { status: 'unsupported', reason: `${platform}_${mediaKind || 'media'}_has_no_public_title_contract` }
    : submitted.title
      ? exactText(body.title, expected.title) && str(body.title)
        ? { status: 'verified' }
        : { status: 'accepted', reason: 'submitted_to_provider_but_not_returned_by_object_read' }
      : { status: 'failed', reason: 'title_not_submitted' };
  const cover = mediaKind !== 'video'
    ? { status: 'unsupported', reason: 'not_applicable_for_static_image' }
    : platform === 'instagram'
    ? submitted.coverUrl
      ? /^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/so_[0-9.]+,f_jpg\//i.test(submitted.coverUrl)
        ? str(body.thumbnail_url)
          ? { status: 'accepted', requested: 'cover_url', thumbnailUrl: str(body.thumbnail_url) }
          : { status: 'failed', reason: 'instagram_thumbnail_missing' }
        : { status: 'failed', reason: 'cover_url_not_canonical' }
      : { status: 'failed', reason: 'cover_not_requested' }
    : { status: 'unsupported', reason: `${platform}_video_cover_not_configurable_in_this_flow` };
  if (platform === 'instagram' && mediaKind === 'video' && cover.status === 'failed') {
    errors.push(`instagram_reel_cover_failed:${cover.reason}`);
  }

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
      cover,
    },
    verificationNotes: compositeFacebook
      ? ['facebook_carousel_post_confirmed_by_public_attached_photo_and_submitted_feed_payload']
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

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
