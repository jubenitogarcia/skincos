const inputItems = $input.all();

const SLOT_CONFIG = [
  { slot: 'feed', acceptedRatios: ['3x4', '4x5', '1x1'] },
  { slot: 'banner', acceptedRatios: ['2x1'] },
  { slot: 'stories', acceptedRatios: ['9x16'] },
];

const RATIO_ORDER = {
  '1x1': 1,
  '2x1': 2,
  '3x4': 3,
  '4x5': 4,
  '9x16': 5,
  '16x9': 6,
};

const CREATIVE_TYPES = new Set([
  'estatico',
  'estatic',
  'static',
  'video',
  'carrossel',
]);

const KNOWN_OFFER_TYPES = new Set([
  'price',
  'regular',
  'sessao',
  'sessoes',
  'desconto',
  'brinde',
  'procedimento_gratis',
  'procedimento',
  'clube_anual',
  'combo',
  'parcelado',
  'avista',
]);

function isCreativeTypePart(part) {
  return CREATIVE_TYPES.has(safeString(part).toLowerCase());
}

function isRatioPart(part) {
  return Boolean(detectRatio(part));
}

function findLastIndex(values, predicate) {
  for (let i = safeArray(values).length - 1; i >= 0; i--) {
    if (predicate(values[i], i)) return i;
  }
  return -1;
}

function safeString(value) {
  return String(value ?? '').trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, '_');
}

function normalizeLandingPageKey(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function normalizeCompactKey(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();

  for (const value of safeArray(values)) {
    const normalized = safeString(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function uniqueObjectsBy(values, getKey) {
  const out = [];
  const seen = new Set();

  for (const value of safeArray(values)) {
    const key = safeString(getKey(value));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function cleanupBrokenFileName(name) {
  return safeString(name)
    .normalize('NFC')
    .replace(/(\.jpg|\.jpeg|\.png|\.webp)+$/i, (match) => {
      const extMatch = match.match(/\.(jpg|jpeg|png|webp)/i);
      return extMatch ? extMatch[0].toLowerCase() : match.toLowerCase();
    })
    .replace(/(jpg|jpeg|png|webp)(2x1|3x4|4x5|9x16|1x1|16x9)(\.(jpg|jpeg|png|webp))$/i, '__$2$3');
}

function stripExtension(name) {
  return safeString(name).replace(/\.[^.]+$/, '').trim();
}

function detectRatio(value) {
  const text = safeString(value).toLowerCase();

  const patterns = [
    { ratio: '9x16', regex: /(?:^|[^a-z0-9])9x16(?:[^a-z0-9]|$)/i },
    { ratio: '16x9', regex: /(?:^|[^a-z0-9])16x9(?:[^a-z0-9]|$)/i },
    { ratio: '4x5', regex: /(?:^|[^a-z0-9])4x5(?:[^a-z0-9]|$)/i },
    { ratio: '3x4', regex: /(?:^|[^a-z0-9])3x4(?:[^a-z0-9]|$)/i },
    { ratio: '2x1', regex: /(?:^|[^a-z0-9])2x1(?:[^a-z0-9]|$)/i },
    { ratio: '1x1', regex: /(?:^|[^a-z0-9])1x1(?:[^a-z0-9]|$)/i },
  ];

  for (const entry of patterns) {
    if (entry.regex.test(text)) return entry.ratio;
  }

  return '';
}

function parseFriendlyOrientationName(value) {
  const normalized = stripExtension(cleanupBrokenFileName(value))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const match = normalized.match(/^(wide|horizontal|vertical|square|quadrado)(?:\s+(.+))?$/i);
  if (!match) return null;

  const orientation = match[1].toLowerCase();
  const groupLabel = safeString(match[2] || 'default');
  const ratioByOrientation = {
    wide: '2x1',
    horizontal: '2x1',
    vertical: '9x16',
    square: '1x1',
    quadrado: '1x1',
  };
  const semanticLabel = /^\d+$|^v\d+$/i.test(groupLabel)
    ? `creative_set_${groupLabel}`
    : groupLabel;

  return {
    orientation,
    ratio: ratioByOrientation[orientation],
    group_label: groupLabel,
    logical_base_name: semanticLabel,
    group_key: `FRIENDLY_${normalizeKey(groupLabel) || 'DEFAULT'}`,
  };
}

function detectSuffixHint(value) {
  const parts = splitStructuredParts(value);

  if (parts.includes('generic')) return 'generic';

  return 'campaign';
}

function removeSuffixHint(value) {
  return safeString(value)
    .replace(/(?:[\s_-]+)(generic|campaign)$/i, '')
    .replace(/[_-]+$/g, '')
    .trim();
}

function stripFileDecorations(name) {
  const cleaned = cleanupBrokenFileName(name);
  const parts = splitStructuredParts(cleaned);

  const ratioIndex = findLastIndex(parts, isRatioPart);

  // Se achou proporção, tudo depois dela é formato, versão ou campanha.
  if (ratioIndex > 0) {
    return parts.slice(0, ratioIndex).join('__').trim();
  }

  return parts
    .filter((part) => !isCreativeTypePart(part))
    .filter((part) => !isRatioPart(part))
    .filter((part) => part !== 'generic' && part !== 'campaign')
    .filter((part) => !/^v\d+$/i.test(part))
    .join('__')
    .trim();
}

function splitStructuredParts(name) {
  const cleaned = cleanupBrokenFileName(name);
  const withoutExt = stripExtension(cleaned);

  const normalized = withoutExt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return normalized
    .split(/__+/)
    .map((part) =>
      safeString(part)
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_')
        .toLowerCase()
    )
    .filter(Boolean);
}

function parseStructuredCreativeName(name) {
  const parts = splitStructuredParts(name);
  if (parts.length < 4) return null;

  const suffix_hint = detectSuffixHint(name);

  const formatIndex = findLastIndex(parts, isRatioPart);
  if (formatIndex < 0) return null;

  const format = parts[formatIndex];

  const prefixParts = parts.slice(0, formatIndex);
  const tailParts = parts.slice(formatIndex + 1);

  const creative_type =
    tailParts.find((part) => isCreativeTypePart(part)) || '';

  const version =
    tailParts.find((part) => /^v\d+$/i.test(part)) || '';

  const campaign_key = tailParts
    .filter((part) => !isCreativeTypePart(part))
    .filter((part) => part !== 'generic' && part !== 'campaign')
    .filter((part) => !/^v\d+$/i.test(part))
    .join('__');

  if (prefixParts.length < 2) return null;

  let offerIndex = -1;

  for (let i = 1; i < prefixParts.length; i++) {
    if (KNOWN_OFFER_TYPES.has(prefixParts[i])) {
      offerIndex = i;
      break;
    }
  }

  if (offerIndex === -1) {
    offerIndex = Math.max(1, prefixParts.length - 3);
  }

  const productKeyParts = prefixParts.slice(0, offerIndex);
  const remainder = prefixParts.slice(offerIndex);

  if (!productKeyParts.length || !remainder.length) return null;

  const offer_type = remainder[0] || '';
  const offer_detail = remainder[1] || '';
  const payment_term = remainder.slice(2).join('__');

  const product_key = productKeyParts.join('__');

  const offer_key = [
    product_key,
    offer_type,
    offer_detail,
    payment_term,
  ].filter(Boolean).join('__');

  const format_key = [
    offer_key,
    format,
    creative_type,
  ].filter(Boolean).join('__');

  return {
    raw_name: name,
    base_name: removeSuffixHint(stripFileDecorations(name)),
    normalized: parts.join('__'),

    product_key,
    item_key: '',
    presentation: '',
    area: '',

    offer_type,
    offer_detail,
    payment_term,

    format,
    creative_type,
    version,
    campaign_key,

    offer_key,
    format_key,
    full_key: format_key,

    suffix_hint,
  };
}

function inferProductFamily(value) {
  const text = normalizeText(value).replace(/_/g, ' ');

  if (text.includes('BIOESTIMULADOR') && text.includes('COLAGENO')) {
    return 'bioestimulador_colageno';
  }

  if (text.includes('BIOESTIMULADOR')) {
    return 'bioestimulador';
  }

  if (text.includes('BOTOX') || text.includes('TOXINA')) {
    return 'botox';
  }

  if (text.includes('PREENCHIMENTO') && text.includes('LABIAL')) {
    return 'preenchimento_labial';
  }

  if (text.includes('PREENCHIMENTO')) {
    return 'preenchimento';
  }

  if (text.includes('LAVIEEN')) {
    return 'lavieen';
  }

  if (text.includes('SCULPTRA')) {
    return 'sculptra';
  }

  if (text.includes('RADIESSE')) {
    return 'radiesse';
  }

  if (text.includes('ELLEVA')) {
    return 'elleva';
  }

  return '';
}

function inferOfferMarkers(value) {
  const text = normalizeText(value).replace(/_/g, ' ');
  const markers = new Set();

  if (text.includes('PRICE') || text.includes('PRECO') || text.includes('A PARTIR') || /R\D*\d+/i.test(safeString(value))) {
    markers.add('price');
  }

  if (text.includes('SESSAO') || text.includes('SESSOES')) markers.add('sessao');
  if (text.includes('AVISTA') || text.includes('PIX')) markers.add('avista');
  if (text.includes('10X') || text.includes('PARCELADO') || text.includes('CARTAO')) markers.add('parcelado');
  if (text.includes('2X1')) markers.add('2x1');
  if (text.includes('BRINDE')) markers.add('brinde');
  if (text.includes('COMBO')) markers.add('combo');
  if (text.includes('REGULAR')) markers.add('regular');

  return [...markers];
}

function scoreOfferMarkerFit(groupMarkers, adMarkers) {
  const groupSet = new Set(safeArray(groupMarkers));
  const adSet = new Set(safeArray(adMarkers));

  let score = 0;
  const reasons = [];

  for (const marker of groupSet) {
    if (adSet.has(marker)) {
      score += 25;
      reasons.push(`marcador compartilhado: ${marker}`);
    }
  }

  // PIX é uma boa aproximação para "à vista".
  if (groupSet.has('avista') && adSet.has('avista')) {
    score += 15;
    reasons.push('pagamento à vista/PIX compatível');
  }

  // Penaliza anúncios antigos com mecânica muito diferente.
  const hardConflicts = ['2x1', 'brinde', 'combo'];

  for (const marker of hardConflicts) {
    if (!groupSet.has(marker) && adSet.has(marker)) {
      score -= 45;
      reasons.push(`penalidade por mecânica diferente: ${marker}`);
    }
  }

  if (groupSet.has('avista') && adSet.has('parcelado') && !adSet.has('avista')) {
    score -= 15;
    reasons.push('pagamento diferente: parcelado vs à vista');
  }

  return { score, reasons };
}

function fingerprintToken(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function fingerprintTag(value) {
  const match = /\[OFV1:([A-Z0-9]+)\]/i.exec(safeString(value));
  return match ? `OFV1:${safeString(match[1]).toUpperCase()}` : '';
}

function canonicalOfferFingerprint({ procedures, price_amount_cents, price_qualifier, payment_terms, condition_terms, validity }) {
  return [
    'v1',
    `p=${safeArray(procedures).map((entry) => `${fingerprintToken(entry.key)}:${fingerprintToken(entry.quantity) || 'unknown'}:${fingerprintToken(entry.unit) || 'unknown'}`).sort().join('+') || 'unknown'}`,
    `price=${Math.max(0, Math.trunc(Number(price_amount_cents || 0)))}:${['fixed', 'from'].includes(fingerprintToken(price_qualifier)) ? fingerprintToken(price_qualifier) : 'unknown'}`,
    `pay=${safeArray(payment_terms).map(fingerprintToken).filter(Boolean).sort().join('+') || 'none'}`,
    `cond=${safeArray(condition_terms).map(fingerprintToken).filter(Boolean).sort().join('+') || 'none'}`,
    `valid=${fingerprintToken(validity) || 'none'}`,
  ].join('|');
}

function normalizedOfferFingerprint(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const procedures = safeArray(source.procedures)
    .map((entry) => entry && typeof entry === 'object' ? entry : {})
    .map((entry) => ({ key: fingerprintToken(entry.key), quantity: fingerprintToken(entry.quantity), unit: fingerprintToken(entry.unit) }))
    .filter((entry) => entry.key);
  const price_amount_cents = Math.max(0, Math.trunc(Number(source.price_amount_cents || 0)));
  const price_qualifier = ['fixed', 'from'].includes(fingerprintToken(source.price_qualifier)) ? fingerprintToken(source.price_qualifier) : 'unknown';
  const payment_terms = safeArray(source.payment_terms).map(fingerprintToken).filter(Boolean);
  const condition_terms = safeArray(source.condition_terms).map(fingerprintToken).filter(Boolean);
  const validity = fingerprintToken(source.validity);
  const evidence = safeArray(source.evidence).map(safeString).filter(Boolean);
  const replacement_eligible = source.replacement_eligible === true && Number(source.confidence) >= 0.9 &&
    procedures.length > 0 && procedures.every((entry) => entry.quantity && entry.unit) &&
    price_amount_cents > 0 && price_qualifier !== 'unknown' && evidence.length > 0;
  return {
    ...source,
    procedures, price_amount_cents, price_qualifier, payment_terms, condition_terms, validity, evidence,
    canonical_key: canonicalOfferFingerprint({ procedures, price_amount_cents, price_qualifier, payment_terms, condition_terms, validity }),
    tag: fingerprintTag(source.tag) || safeString(source.tag),
    replacement_eligible,
    status: replacement_eligible ? 'verified' : 'unverified',
  };
}

function centsFromText(value) {
  const match = /R\$\s*([0-9]{1,6})(?:[\.,]([0-9]{1,2}))?/i.exec(safeString(value));
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] || '0').padEnd(2, '0').slice(0, 2));
}

function legacyOfferFingerprint(ad) {
  const search = buildAdSearchText(ad);
  const tag = fingerprintTag(ad && ad.name) || fingerprintTag(search);
  if (tag) return { status: 'tagged', tag, replacement_eligible: true, source: 'internal_ad_name_tag' };
  const normalized = normalizeText(search).replace(/_/g, ' ');
  const procedures = [];
  const botox = /(?:BOTOX|TOXINA)[^0-9]{0,32}([0-9]{1,3})\s*(UI|U)\b/i.exec(normalized);
  if (botox) procedures.push({ key: 'botox', quantity: botox[1], unit: botox[2].toLowerCase() === 'u' ? 'ui' : botox[2].toLowerCase() });
  const filler = /PREENCHIMENTO(?:\s+LABIAL)?[^0-9]{0,40}([0-9]+(?:[\.,][0-9]+)?)\s*(ML)\b/i.exec(normalized);
  if (filler) procedures.push({ key: /PREENCHIMENTO\s+LABIAL/i.test(normalized) ? 'preenchimento_labial' : 'preenchimento', quantity: filler[1].replace(',', '.'), unit: filler[2].toLowerCase() });
  const price_amount_cents = centsFromText(search);
  const price_qualifier = /A\s+PARTIR\s+DE/i.test(normalized) ? 'from' : price_amount_cents ? 'fixed' : 'unknown';
  const payment_terms = [
    ...(normalized.match(/\b([0-9]{1,2})X\b/g) || []).map((entry) => `parcelado_${entry.toLowerCase()}`),
    ...(normalized.includes('PIX') ? ['pix'] : []),
    ...(normalized.includes('A VISTA') ? ['avista'] : []),
  ];
  const condition_terms = ['COMBO', 'BRINDE', 'DESCONTO'].filter((term) => normalized.includes(term)).map((term) => term.toLowerCase());
  const validityMatch = /(?:VALID[AO]\s+DE\s+)?([0-3]?[0-9]\s*(?:A|ATE)\s*[0-3]?[0-9](?:\/[0-1]?[0-9](?:\/[0-9]{2,4})?)?)/i.exec(normalized);
  const validity = validityMatch ? fingerprintToken(validityMatch[1]) : '';
  const fingerprint = normalizedOfferFingerprint({
    confidence: procedures.length && price_amount_cents ? 1 : 0,
    procedures, price_amount_cents, price_qualifier, payment_terms, condition_terms, validity,
    evidence: procedures.length && price_amount_cents ? ['creative_text_reconstructed'] : [],
    replacement_eligible: procedures.length > 0 && procedures.every((entry) => entry.quantity && entry.unit) && price_amount_cents > 0,
  });
  return { ...fingerprint, source: 'creative_text_reconstructed' };
}

function compareOfferFingerprints(expectedRaw, candidateRaw) {
  const expected = normalizedOfferFingerprint(expectedRaw);
  const candidate = candidateRaw && candidateRaw.status === 'tagged'
    ? candidateRaw
    : normalizedOfferFingerprint(candidateRaw);
  if (!expected.replacement_eligible) return { status: 'offer_fingerprint_unverified', expected, candidate };
  if (candidate.status === 'tagged') {
    const expectedTag = fingerprintTag(expected.tag) || safeString(expected.tag).replace(/^\[|\]$/g, '');
    return candidate.tag && candidate.tag === expectedTag
      ? { status: 'exact', source: 'internal_ad_name_tag', expected, candidate }
      : { status: 'offer_fingerprint_mismatch', source: 'internal_ad_name_tag', expected, candidate };
  }
  if (!candidate.replacement_eligible) return { status: 'offer_fingerprint_unverified', expected, candidate };
  return candidate.canonical_key === expected.canonical_key
    ? { status: 'exact', source: 'legacy_creative_text', expected, candidate }
    : { status: 'offer_fingerprint_mismatch', source: 'legacy_creative_text', expected, candidate };
}

function parseStructuredCreativeNameFromText(text) {
  const direct = parseStructuredCreativeName(text);
  if (direct) return direct;

  const normalized = safeString(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  if (!normalized) return null;

  const candidates = normalized.match(/([a-z0-9_]+(?:__[a-z0-9_]+){5,})/g) || [];

  for (const candidate of candidates) {
    const parsed = parseStructuredCreativeName(candidate);
    if (parsed) return parsed;
  }

  return null;
}

const stopWords = new Set([
  'A', 'AS', 'O', 'OS', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'NO', 'NA', 'NOS', 'NAS',
  'PARA', 'POR', 'COM', 'SEM', 'UM', 'UMA', 'UNS', 'UMAS',
  'CAMPAIGN', 'CAMPANHA', 'AD', 'ADS', 'LEAD', 'LEADS', 'WA', 'WHATSAPP',
  'ANUNCIO', 'ANUNCIOS', 'CONJUNTO', 'ADSET', 'CRIATIVO', 'CRIATIVOS', 'COPY',
  'ESPACO', 'FACIAL', 'BARRASHOPPINGSUL', 'NOVO', 'HAMBURGO',
  'MES', 'CONSUMIDOR', 'OFERTA', 'EXCLUSIVO', 'EXCLUSIVA', 'TEMPO', 'LIMITADO',
  'REGULAR', 'BRINDE', 'DESCONTO', 'PROCEDIMENTO', 'GRATIS',
  'PADRAO', 'PIX', 'ESTATICO', 'ESTATIC', 'STATIC', 'VIDEO', 'CARROSSEL',
  'GENERIC',
]);

function tokenize(value) {
  return normalizeText(value)
    .replace(/_/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token));
}

function extractCreativeTexts(ad) {
  const creative = ad && ad.creative ? ad.creative : {};
  const assetFeed = creative.asset_feed_spec || {};
  const storySpec = creative.object_story_spec || {};
  const linkData = storySpec.link_data || {};

  return {
    titles: uniqueStrings([
      ...safeArray(assetFeed.titles).map((item) => item && item.text),
      creative.title,
      linkData.name,
    ]),
    bodies: uniqueStrings([
      ...safeArray(assetFeed.bodies).map((item) => item && item.text),
      creative.body,
      linkData.message,
    ]),
    descriptions: uniqueStrings([
      ...safeArray(assetFeed.descriptions).map((item) => item && item.text),
      linkData.description,
    ]),
  };
}

function buildAdSearchText(ad) {
  const texts = extractCreativeTexts(ad);
  return [
    safeString(ad && ad.name),
    ...texts.titles,
    ...texts.bodies,
    ...texts.descriptions,
  ].join(' ');
}

function detectRatioFromLabelName(labelName) {
  const normalized = normalizeText(labelName);

  if (normalized.includes('IMAGE 1') || normalized.includes('IMAGE_1')) return '3x4';
  if (normalized.includes('IMAGE 2') || normalized.includes('IMAGE_2')) return '2x1';
  if (normalized.includes('IMAGE 3') || normalized.includes('IMAGE_3')) return '9x16';

  if (normalized.includes('9X16')) return '9x16';
  if (normalized.includes('16X9')) return '16x9';
  if (normalized.includes('4X5')) return '4x5';
  if (normalized.includes('3X4')) return '3x4';
  if (normalized.includes('2X1')) return '2x1';
  if (normalized.includes('1X1')) return '1x1';

  return '';
}

function inferRatioFromImageCrops(imageCrops) {
  const cropKeys = Object.keys(imageCrops || {}).map((key) => safeString(key));

  const cropMap = {
    '191x100': '2x1',
    '100x100': '3x4',
    '400x500': '4x5',
    '300x400': '3x4',
    '600x750': '4x5',
    '768x1024': '3x4',
    '90x160': '9x16',
    '160x90': '16x9',
    '1080x1920': '9x16',
    '1920x1080': '16x9',
    '1080x1080': '1x1',
    '1200x628': '2x1',
  };

  for (const key of cropKeys) {
    if (cropMap[key]) return cropMap[key];
  }

  return '';
}

function inferRatioFromRule(rule, creativeImages) {
  const customization = rule && rule.customization_spec ? rule.customization_spec : {};
  const imageLabel = rule && rule.image_label ? rule.image_label : {};
  const labelName = safeString(imageLabel.name);

  const ratioFromLabel = detectRatioFromLabelName(labelName);
  if (ratioFromLabel) return ratioFromLabel;

  const allPositions = [
    ...safeArray(customization.publisher_platforms),
    ...safeArray(customization.facebook_positions),
    ...safeArray(customization.instagram_positions),
    ...safeArray(customization.audience_network_positions),
    ...safeArray(customization.messenger_positions),
  ].map((value) => safeString(value).toLowerCase());

  if (allPositions.some((value) => ['story', 'stories', 'reels', 'facebook_reels', 'instagram_reels'].includes(value))) {
    return '9x16';
  }

  if (allPositions.includes('search')) {
    return '2x1';
  }

  if (allPositions.some((value) =>
    [
      'feed',
      'stream',
      'explore',
      'explore_home',
      'marketplace',
      'notification',
      'instream_video',
      'video_feeds',
      'right_hand_column',
      'facebook_feed',
      'instagram_stream',
    ].includes(value)
  )) {
    return '3x4';
  }

  const imageId = safeString(imageLabel.id);
  const creativeImage = safeArray(creativeImages).find((img) =>
    safeArray(img && img.adlabels).some((label) => safeString(label && label.id) === imageId)
  );

  return inferRatioFromImageCrops(creativeImage && creativeImage.image_crops ? creativeImage.image_crops : {});
}

function binaryKeyForRatio(ratio) {
  return `data_${safeString(ratio).replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function binaryKeyForRole(role) {
  return `data_${safeString(role).replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function ratioToSlot(ratio) {
  const normalizedRatio = safeString(ratio);
  const config = SLOT_CONFIG.find((entry) => entry.acceptedRatios.includes(normalizedRatio));
  return config ? config.slot : '';
}

function preferredRatiosForSlot(slot) {
  const config = SLOT_CONFIG.find((entry) => entry.slot === slot);
  return config ? config.acceptedRatios : [];
}

function getRequiredRatiosForGroup(group) {
  const selectedRatios = [];

  for (const config of SLOT_CONFIG) {
    const match = safeArray(group.imagens).find((image) => config.acceptedRatios.includes(safeString(image.proporcao)));
    if (!match) return [];
    selectedRatios.push(safeString(match.proporcao));
  }

  return selectedRatios;
}

function pickMediaItemForTargetRatio(targetRatio, mediaInventoryByRatio) {
  const exact = mediaInventoryByRatio.get(safeString(targetRatio));
  if (exact) return exact;

  const targetSlot = ratioToSlot(targetRatio);
  if (!targetSlot) return null;

  for (const mediaItem of mediaInventoryByRatio.values()) {
    if (ratioToSlot(mediaItem && mediaItem.proporcao) === targetSlot) {
      return mediaItem;
    }
  }

  return null;
}

function buildReplacementPlanForAd(ad, mediaInventoryByRatio) {
  const creative = ad && ad.creative ? ad.creative : {};
  const assetFeed = creative.asset_feed_spec || {};
  const rules = safeArray(assetFeed.asset_customization_rules);
  const creativeImages = safeArray(assetFeed.images);

  const plan = [];

  for (const rule of rules) {
    const targetRatio = inferRatioFromRule(rule, creativeImages);
    if (!targetRatio) continue;

    const mediaItem = pickMediaItemForTargetRatio(targetRatio, mediaInventoryByRatio);
    if (!mediaItem) continue;

    plan.push({
      ad_id: safeString(ad.id),
      ad_name: safeString(ad.name),
      creative_id: safeString(creative.id),
      ratio: safeString(mediaItem.proporcao),
      target_ratio: safeString(targetRatio),
      replacement_slot: ratioToSlot(mediaItem.proporcao) || ratioToSlot(targetRatio),
      binary_key: safeString(mediaItem.binary_key),
      new_image_drive_id: safeString(mediaItem.id),
      new_image_name: safeString(mediaItem.name),
      target_image_label_id: safeString(rule && rule.image_label && rule.image_label.id),
      target_image_label_name: safeString(rule && rule.image_label && rule.image_label.name),
      rule_priority: rule && rule.priority != null ? rule.priority : null,
      inferred_from_positions: true,
      ratio_was_adapted: safeString(mediaItem.proporcao) !== safeString(targetRatio),
    });
  }

  return uniqueObjectsBy(plan, (item) =>
    [item.ad_id, item.target_ratio, item.target_image_label_id || item.target_image_label_name].join('::')
  );
}

function buildMatchDecision(groupMeta, adMeta) {
  const reasons = [];
  let match_level = 'none';
  let score = 0;

  if (
    groupMeta?.offer_key &&
    adMeta?.parsed_naming?.offer_key &&
    groupMeta.offer_key === adMeta.parsed_naming.offer_key
  ) {
    match_level = 'offer_key_exact';
    score = 1000;
    reasons.push('offer_key exata');
  } else if (
    groupMeta?.product_key &&
    adMeta?.parsed_naming?.product_key &&
    groupMeta.product_key === adMeta.parsed_naming.product_key &&
    groupMeta.offer_type === adMeta.parsed_naming.offer_type &&
    groupMeta.offer_detail === adMeta.parsed_naming.offer_detail
  ) {
    match_level = 'product_plus_offer';
    score = 800;
    reasons.push('product_key + offer_type + offer_detail');
  } else if (
    groupMeta?.product_key &&
    adMeta?.parsed_naming?.product_key &&
    groupMeta.product_key === adMeta.parsed_naming.product_key
  ) {
    match_level = 'product_only';
    score = 600;
    reasons.push('product_key exata');
  } else if (
    groupMeta?.product_family &&
    adMeta?.product_family &&
    groupMeta.product_family === adMeta.product_family
  ) {
    match_level = 'product_family_offer_fit';
    score = 420;
    reasons.push(`familia de produto compatível: ${groupMeta.product_family}`);
  } else if (
    groupMeta?.product_family &&
    adMeta?.product_family &&
    (
      groupMeta.product_family.includes(adMeta.product_family) ||
      adMeta.product_family.includes(groupMeta.product_family)
    )
  ) {
    match_level = 'product_family_soft';
    score = 320;
    reasons.push(`familia de produto aproximada: ${groupMeta.product_family} ~ ${adMeta.product_family}`);
  }

  const markerFit = scoreOfferMarkerFit(groupMeta.offer_markers, adMeta.offer_markers);
  score += markerFit.score;
  reasons.push(...markerFit.reasons);

  const groupTokenSet = new Set(groupMeta.tokens || []);
  const sharedTokens = safeArray(adMeta.tokens).filter((token) => groupTokenSet.has(token));
  let textScore = sharedTokens.length * 6;

  if (groupMeta.compact_name && adMeta.compact_name && adMeta.compact_name.includes(groupMeta.compact_name)) textScore += 12;
  if (groupMeta.normalized_name && adMeta.normalized_name && adMeta.normalized_name.includes(groupMeta.normalized_name)) textScore += 8;

  const exactTokenMatch =
    safeArray(groupMeta.tokens).length > 0 &&
    safeArray(groupMeta.tokens).every((token) => safeArray(adMeta.tokens).includes(token));

  if (exactTokenMatch) textScore += 10;

  const exactNameMatch = Boolean(groupMeta.normalized_name && adMeta.normalized_name === groupMeta.normalized_name);
  if (exactNameMatch) textScore += 20;

  if (match_level === 'none' && textScore > 0) {
    match_level = 'text_fallback';
    score = textScore;
    reasons.push('fallback textual');
  } else {
    score += textScore;
    if (textScore > 0) reasons.push(`reforco textual ${textScore}`);
  }

  return {
    match_level,
    score,
    reasons,
    shared_tokens: sharedTokens,
    exact_name_match: exactNameMatch,
    exact_token_match: exactTokenMatch,
  };
}

function buildSourceAdTexts(sourceAd) {
  if (!sourceAd) {
    return { titles: [], bodies: [], descriptions: [] };
  }
  return extractCreativeTexts(sourceAd);
}

function createJobKey(parts) {
  return normalizeKey(parts.filter(Boolean).join('__'));
}

function inferUnitKey(value) {
  const text = normalizeText(value).replace(/_/g, ' ');
  const compact = text.replace(/\s+/g, '');

  if (
    compact.includes('BARRASHOPPINGSUL') ||
    text.includes('BARRA SHOPPING SUL') ||
    /(?:^|\s)BSS(?:\s|$)/.test(text)
  ) {
    return 'bss';
  }

  if (
    text.includes('NOVO HAMBURGO') ||
    /(?:^|\s)NH(?:\s|$)/.test(text)
  ) {
    return 'nh';
  }

  return '';
}

function buildAdUnitSearchText(matchedAd) {
  const source = matchedAd && matchedAd.source_ad ? matchedAd.source_ad : {};
  const adset = source.adset || {};
  const campaign = source.campaign || {};

  return [
    matchedAd && matchedAd.ad_name,
    source.name,
    adset.name,
    campaign.name,
  ].join(' ');
}

function buildDestinationUnitSearchText(destination) {
  return [
    destination && destination.destination_group,
    destination && destination.group,
    destination && destination.name,
    destination && destination.adset_name,
    destination && destination.destination_adset_name,
    destination && destination.page_name,
    destination && destination.row_number,
  ].join(' ');
}

function selectBestAdsByDestination(selectedAds, destinations) {
  const ordered = safeArray(selectedAds)
    .slice()
    .sort((a, b) => b.score - a.score || safeString(a.ad_name).localeCompare(safeString(b.ad_name)));

  const remaining = ordered.slice();
  const chosen = [];
  const destinationUnits = uniqueStrings(
    safeArray(destinations)
      .map((destination) => inferUnitKey(buildDestinationUnitSearchText(destination)))
      .filter(Boolean)
  );

  for (const destinationUnit of destinationUnits) {
    const bestIndex = remaining.findIndex((ad) => inferUnitKey(buildAdUnitSearchText(ad)) === destinationUnit);

    if (bestIndex >= 0) {
      chosen.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    }
  }

  if (chosen.length) return chosen;

  const maxAds = Math.max(1, destinationUnits.length || safeArray(destinations).length || 1);
  return ordered.slice(0, maxAds);
}

function limitSelectedAdsForSafety(selectedAds, destinations) {
  const ordered = safeArray(selectedAds)
    .slice()
    .sort((a, b) => b.score - a.score || safeString(a.ad_name).localeCompare(safeString(b.ad_name)));

  if (!ordered.length) return [];

  const firstLevel = safeString(ordered[0].match_level);
  const broadLevels = new Set(['product_only', 'product_family_offer_fit', 'product_family_soft', 'text_fallback']);

  if (safeArray(destinations).length > 1) {
    return selectBestAdsByDestination(ordered, destinations);
  }

  if (broadLevels.has(firstLevel)) {
    return ordered.slice(0, 1);
  }

  return ordered.slice(0, Math.min(3, ordered.length));
}

function isDriveItem(item) {
  return Boolean(
    safeString(item?.id) &&
    safeString(item?.name) &&
    !Object.prototype.hasOwnProperty.call(item || {}, 'row_number') &&
    !Object.prototype.hasOwnProperty.call(item || {}, 'data') &&
    !Object.prototype.hasOwnProperty.call(item || {}, 'creative')
  );
}

function isDestinationItem(item) {
  return Boolean(
    Object.prototype.hasOwnProperty.call(item || {}, 'row_number') &&
    Object.prototype.hasOwnProperty.call(item || {}, 'destination_group') &&
    (
      Object.prototype.hasOwnProperty.call(item || {}, 'account_id') ||
      Object.prototype.hasOwnProperty.call(item || {}, 'page_id') ||
      Object.prototype.hasOwnProperty.call(item || {}, 'instagram_user_id') ||
      Object.prototype.hasOwnProperty.call(item || {}, 'campaign_id') ||
      Object.prototype.hasOwnProperty.call(item || {}, 'adset_id')
    )
  );
}

function flattenDataEntries(items) {
  const out = [];

  for (const item of safeArray(items)) {
    const data = item && item.data;
    if (!Array.isArray(data)) continue;

    for (const entry of data) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        out.push(entry);
      }
    }
  }

  return out;
}

function buildCreativeGrouping(nameContext) {
  const parsed = nameContext && nameContext.parsed_naming ? nameContext.parsed_naming : null;
  const logicalBaseName = safeString(nameContext && nameContext.logical_base_name);
  const offerKey = parsed && safeString(parsed.offer_key) ? safeString(parsed.offer_key) : '';
  const campaignKey = parsed && safeString(parsed.campaign_key) ? safeString(parsed.campaign_key) : '';
  const version = parsed && safeString(parsed.version) ? safeString(parsed.version) : '';
  const discriminatorParts = uniqueStrings([campaignKey, version]);
  const groupingDiscriminator = discriminatorParts.join('__');

  if (offerKey && groupingDiscriminator) {
    return {
      offer_group_key: normalizeKey(offerKey),
      creative_group_key: normalizeKey([offerKey, groupingDiscriminator].filter(Boolean).join('__')),
      grouping_discriminator: groupingDiscriminator,
      grouping_strategy: 'offer_key_plus_campaign_or_version',
    };
  }

  if (offerKey) {
    return {
      offer_group_key: normalizeKey(offerKey),
      creative_group_key: normalizeKey(offerKey),
      grouping_discriminator: '',
      grouping_strategy: 'offer_key_only',
    };
  }

  return {
    offer_group_key: normalizeKey(logicalBaseName),
    creative_group_key: normalizeKey(logicalBaseName),
    grouping_discriminator: '',
    grouping_strategy: 'logical_base_name',
  };
}

function buildNameContext(name) {
  const rawName = safeString(name).normalize('NFC');
  const cleanedName = cleanupBrokenFileName(rawName);
  const friendlyOrientation = parseFriendlyOrientationName(cleanedName);
  const ratio = detectRatio(cleanedName) || safeString(friendlyOrientation && friendlyOrientation.ratio);
  const rawBaseWithoutExt = stripExtension(cleanedName);
  const suffix_hint = detectSuffixHint(rawBaseWithoutExt);
  const logicalBaseWithSuffix = rawBaseWithoutExt;
  const logicalBaseName = friendlyOrientation
    ? safeString(friendlyOrientation.logical_base_name)
    : stripFileDecorations(cleanedName);
  const parsedNaming = friendlyOrientation ? null : parseStructuredCreativeName(cleanedName);

  const effectiveSuffixHint =
    safeString(parsedNaming && parsedNaming.suffix_hint) ||
    suffix_hint;

  const grouping = friendlyOrientation
    ? {
        offer_group_key: normalizeKey(logicalBaseName),
        creative_group_key: safeString(friendlyOrientation.group_key),
        grouping_discriminator: safeString(friendlyOrientation.group_label),
        grouping_strategy: 'friendly_orientation_plus_set',
      }
    : buildCreativeGrouping({
        logical_base_name: logicalBaseName,
        parsed_naming: parsedNaming ? deepClone(parsedNaming) : null,
      });

  return {
    raw_name: rawName,
    cleaned_name: cleanedName,
    ratio,
    suffix_hint: effectiveSuffixHint,
    logical_base_name: logicalBaseName,
    logical_base_with_suffix: logicalBaseWithSuffix,
    friendly_orientation: friendlyOrientation ? deepClone(friendlyOrientation) : null,
    parsed_naming: parsedNaming ? deepClone(parsedNaming) : null,
    offer_group_key: grouping.offer_group_key,
    creative_group_key: grouping.creative_group_key,
    grouping_discriminator: grouping.grouping_discriminator,
    grouping_strategy: grouping.grouping_strategy,
    group_key: grouping.creative_group_key,
  };
}

function buildEffectiveNameContext(json, name) {
  const visual = json && typeof json.visual_grouping === 'object' && !Array.isArray(json.visual_grouping)
    ? json.visual_grouping
    : null;
  if (!visual || safeString(visual.strategy) !== 'ai_visual_global') return buildNameContext(name);

  const groupKey = normalizeKey(visual.group_key);
  const ratio = safeString(visual.ratio).toLowerCase();
  const visualConcept = safeString(visual.visual_concept) || groupKey;
  if (!groupKey || !ratio) return buildNameContext(name);

  return {
    raw_name: safeString(name).normalize('NFC'),
    cleaned_name: cleanupBrokenFileName(name),
    ratio,
    suffix_hint: 'campaign',
    logical_base_name: visualConcept,
    logical_base_with_suffix: visualConcept,
    friendly_orientation: null,
    parsed_naming: null,
    offer_group_key: normalizeKey(visualConcept) || groupKey,
    creative_group_key: groupKey,
    grouping_discriminator: groupKey,
    grouping_strategy: 'ai_visual_global',
    group_key: groupKey,
    visual_grouping: deepClone(visual),
  };
}

function registerBinaryBucket(map, key, payload) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(payload);
}

function sortCandidatesForSlot(candidates, slot, preferredSuffixHint) {
  const preferredRatios = preferredRatiosForSlot(slot);

  return safeArray(candidates).slice().sort((left, right) => {
    const leftBinary = left.binary_found ? 1 : 0;
    const rightBinary = right.binary_found ? 1 : 0;
    if (leftBinary !== rightBinary) return rightBinary - leftBinary;

    const leftSuffix = safeString(left.suffix_hint) === safeString(preferredSuffixHint) ? 1 : 0;
    const rightSuffix = safeString(right.suffix_hint) === safeString(preferredSuffixHint) ? 1 : 0;
    if (leftSuffix !== rightSuffix) return rightSuffix - leftSuffix;

    const leftRatioOrder = preferredRatios.indexOf(safeString(left.proporcao));
    const rightRatioOrder = preferredRatios.indexOf(safeString(right.proporcao));
    if (leftRatioOrder !== rightRatioOrder) {
      return (leftRatioOrder === -1 ? 999 : leftRatioOrder) - (rightRatioOrder === -1 ? 999 : rightRatioOrder);
    }

    const leftGlobalOrder = RATIO_ORDER[safeString(left.proporcao)] || 999;
    const rightGlobalOrder = RATIO_ORDER[safeString(right.proporcao)] || 999;
    if (leftGlobalOrder !== rightGlobalOrder) return leftGlobalOrder - rightGlobalOrder;

    return safeString(left.name).localeCompare(safeString(right.name));
  });
}

function chooseBestBinaryRef(candidates, preferredFileName, preferredSuffixHint) {
  const normalizedPreferredFile = normalizeKey(cleanupBrokenFileName(preferredFileName));

  return safeArray(candidates)
    .slice()
    .sort((left, right) => {
      const leftExact = normalizeKey(cleanupBrokenFileName(left.fileName)) === normalizedPreferredFile ? 1 : 0;
      const rightExact = normalizeKey(cleanupBrokenFileName(right.fileName)) === normalizedPreferredFile ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;

      const leftSuffix = safeString(left.suffix_hint) === safeString(preferredSuffixHint) ? 1 : 0;
      const rightSuffix = safeString(right.suffix_hint) === safeString(preferredSuffixHint) ? 1 : 0;
      if (leftSuffix !== rightSuffix) return rightSuffix - leftSuffix;

      return safeString(left.fileName).localeCompare(safeString(right.fileName));
    })[0] || null;
}

function pickResolvedBinary(binaryState, group, image) {
  const driveMatch = binaryState.byDriveId.get(safeString(image.id)) || null;
  if (driveMatch) return driveMatch;
  const exactKey = normalizeKey(cleanupBrokenFileName(image.name || image.original_name));
  const exactMatch = binaryState.byExactName.get(exactKey) || null;
  if (exactMatch) return exactMatch;

  const fallbackKey = `${group.group_key}::${image.proporcao}`;
  const bucket = binaryState.byGroupAndRatio.get(fallbackKey) || [];
  return chooseBestBinaryRef(bucket, image.name || image.original_name, group.suffix_hint);
}

function buildFailure(debug, message) {
  throw new Error(`${message} | debug=${JSON.stringify(debug)}`);
}

const allJson = inputItems.map((item) => (item && item.json ? item.json : item || {}));
const driveItems = allJson.filter(isDriveItem);
const destinations = allJson.filter(isDestinationItem);
const flattenedData = flattenDataEntries(allJson);
const placementChecks = allJson.flatMap((item) => safeArray(item && item.placement_checks));

function placementCheckForDestination(destination) {
  const adsetId = safeString(destination && (destination.adset_id || destination.destination_adset_id));
  const group = normalizeCompactKey(destination && destination.destination_group);
  return placementChecks.find((entry) => safeString(entry && entry.adset_id) === adsetId) ||
    placementChecks.find((entry) => normalizeCompactKey(entry && entry.destination_group) === group) ||
    null;
}

const sourceAds = uniqueObjectsBy(
  flattenedData.filter((item) =>
    safeString(item.id) &&
    safeString(item.name) &&
    safeString(item.adset_id) &&
    safeString(item.campaign_id) &&
    item.creative
  ),
  (item) => safeString(item.id)
);

const binaryState = {
  byDriveId: new Map(),
  byExactName: new Map(),
  byGroupAndRatio: new Map(),
};

for (const item of inputItems) {
  const itemJson = item && item.json ? item.json : {};
  const binaryData = item?.binary?.data;
  const fileName = safeString(binaryData?.fileName || itemJson.name);
  if (!binaryData || !fileName) continue;
  const context = buildEffectiveNameContext(itemJson, itemJson.name || fileName);
  const payload = {
    data: deepClone(binaryData),
    thumbnail: deepClone(item?.binary?.thumbnail || null),
    analysis: deepClone(item?.binary?.analysis || null),
    fileName,
    source_file_id: safeString(itemJson.id),
    media_type: safeString(itemJson.visual_grouping?.media_type || (safeString(binaryData.mimeType).startsWith('video/') ? 'video' : 'image')),
    role: safeString(itemJson.visual_grouping?.role),
    group_key: context.group_key,
    offer_group_key: context.offer_group_key,
    creative_group_key: context.creative_group_key,
    grouping_discriminator: context.grouping_discriminator,
    grouping_strategy: context.grouping_strategy,
    ratio: context.ratio,
    suffix_hint: context.suffix_hint,
  };
  if (payload.source_file_id) binaryState.byDriveId.set(payload.source_file_id, payload);
  binaryState.byExactName.set(normalizeKey(cleanupBrokenFileName(fileName)), payload);
  registerBinaryBucket(binaryState.byGroupAndRatio, `${context.group_key}::${context.ratio}`, payload);
}

const groups = new Map();

for (const json of driveItems) {
  const id = safeString(json.id);
  const nameContext = buildEffectiveNameContext(json, json.name);

  if (!id || !nameContext.cleaned_name || !nameContext.ratio) continue;

  if (!groups.has(nameContext.group_key)) {
    const visualOfferFingerprint = normalizedOfferFingerprint(nameContext.visual_grouping?.offer_fingerprint);
    groups.set(nameContext.group_key, {
      nome_base: nameContext.logical_base_name,
      group_key: nameContext.group_key,
      offer_group_key: nameContext.offer_group_key,
      creative_group_key: nameContext.creative_group_key,
      grouping_discriminator: nameContext.grouping_discriminator,
      grouping_strategy: nameContext.grouping_strategy,
      normalized_name: normalizeText(nameContext.logical_base_name),
      compact_name: normalizeCompactKey(nameContext.logical_base_name),
      tokens: tokenize(nameContext.logical_base_name),
      product_family: inferProductFamily(nameContext.logical_base_name || nameContext.cleaned_name),
      offer_markers: inferOfferMarkers(nameContext.logical_base_name),
      offer_fingerprint: visualOfferFingerprint,
      parsed_naming: nameContext.parsed_naming ? deepClone(nameContext.parsed_naming) : null,
      product_key: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.product_key) : '',
      item_key: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.item_key) : '',
      presentation: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.presentation) : '',
      area: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.area) : '',
      offer_type: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.offer_type) : '',
      offer_detail: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.offer_detail) : '',
      payment_term: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.payment_term) : '',
      offer_key: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.offer_key) : '',
      format: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.format) : '',
      creative_type: nameContext.parsed_naming ? safeString(nameContext.parsed_naming.creative_type) : '',
      suffix_hints_found: [],
      candidates_by_slot: {
        feed: [],
        banner: [],
        stories: [],
      },
      video_candidates: [],
      all_candidates: [],
    });
  }

  const currentGroup = groups.get(nameContext.group_key);
  const currentFingerprint = normalizedOfferFingerprint(nameContext.visual_grouping?.offer_fingerprint);
  if (currentFingerprint.canonical_key !== currentGroup.offer_fingerprint.canonical_key) {
    return buildFailure({ group_key: nameContext.group_key }, 'As midias do mesmo grupo visual retornaram offer_fingerprint divergente.');
  }
  const mediaType = safeString(json.visual_grouping?.media_type || (safeString(json.mimeType || json.mime_type).toLowerCase().startsWith('video/') ? 'video' : 'image')).toLowerCase();
  const role = safeString(json.visual_grouping?.role || (mediaType === 'video' ? 'vertical_video' : '')).toLowerCase();
  const slot = mediaType === 'image' ? ratioToSlot(nameContext.ratio) : '';
  const binaryRef = pickResolvedBinary(binaryState, currentGroup, {
    name: nameContext.cleaned_name,
    original_name: json.name,
    proporcao: nameContext.ratio,
  });

  const candidate = {
    id,
    name: nameContext.cleaned_name,
    original_name: safeString(json.name).normalize('NFC'),
    mime_type: safeString(json.mimeType || json.mime_type),
    md5_checksum: safeString(json.md5Checksum || json.md5_checksum),
    modified_time: safeString(json.modifiedTime || json.modified_time),
    size: safeString(json.size),
    media_type: mediaType,
    role,
    output_checksum_sha256: safeString(json.media_processing?.output_checksum_sha256),
    thumbnail_checksum_sha256: safeString(json.media_processing?.thumbnail_checksum_sha256),
    duration_seconds: Number(json.media_processing?.duration_seconds || 0),
    media_processing: deepClone(json.media_processing || {}),
    proporcao: nameContext.ratio,
    slot,
    extension: safeString(nameContext.cleaned_name).match(/(\.[^.]+)$/)?.[1] || '',
    binary_found: Boolean(binaryRef && binaryRef.data),
    suffix_hint: nameContext.suffix_hint,
  };

  currentGroup.all_candidates.push(candidate);

  if (nameContext.suffix_hint) {
    currentGroup.suffix_hints_found.push(nameContext.suffix_hint);
  }

  if (mediaType === 'video') {
    currentGroup.video_candidates.push(candidate);
  } else if (slot) {
    currentGroup.candidates_by_slot[slot].push(candidate);
  }
}

const requiresVideo = driveItems.some((item) => safeString(item.visual_grouping?.media_type || item.mimeType || item.mime_type).toLowerCase().includes('video'));

const candidateGroupDebug = [];
const groupedCreatives = [];

for (const group of groups.values()) {
  const suffixCounts = group.suffix_hints_found.reduce((acc, hint) => {
    acc[hint] = (acc[hint] || 0) + 1;
    return acc;
  }, {});

  const suffix_hint =
    (suffixCounts.generic || 0) > (suffixCounts.campaign || 0) ? 'generic'
    : (suffixCounts.campaign || 0) > (suffixCounts.generic || 0) ? 'campaign'
    : safeString(group.suffix_hints_found[0]);

  group.suffix_hint = suffix_hint;

  const selectedImages = [];
  const duplicate_ratios = {};

  for (const config of SLOT_CONFIG) {
    const candidates = sortCandidatesForSlot(group.candidates_by_slot[config.slot], config.slot, suffix_hint);
    if (candidates.length > 1) {
      duplicate_ratios[config.slot] = candidates.map((candidate) => safeString(candidate.proporcao));
    }
    if (candidates[0]) {
      selectedImages.push(candidates[0]);
    }
  }

  selectedImages.sort((left, right) =>
    (RATIO_ORDER[safeString(left.proporcao)] || 999) - (RATIO_ORDER[safeString(right.proporcao)] || 999)
  );

  group.imagens = selectedImages.map((image) => ({
    id: image.id,
    name: image.name,
    original_name: image.original_name,
    proporcao: image.proporcao,
    extension: image.extension,
    binary_key: binaryKeyForRatio(image.proporcao),
    mime_type: image.mime_type,
    md5_checksum: image.md5_checksum,
    modified_time: image.modified_time,
    size: image.size,
    media_type: 'image',
    role: image.slot === 'feed' ? 'feed_image' : image.slot === 'banner' ? 'banner_image' : 'vertical_image',
  }));

  const selectedVideos = group.video_candidates.filter((candidate) => candidate.role === 'vertical_video' && candidate.proporcao === '9x16');
  group.videos = selectedVideos.slice(0, 1).map((video) => ({
    id: video.id,
    name: video.name,
    original_name: video.original_name,
    proporcao: video.proporcao,
    role: 'vertical_video',
    media_type: 'video',
    binary_key: binaryKeyForRole('vertical_video'),
    thumbnail_binary_key: 'thumbnail_vertical_video',
    mime_type: video.mime_type,
    output_checksum_sha256: video.output_checksum_sha256,
    thumbnail_checksum_sha256: video.thumbnail_checksum_sha256,
    duration_seconds: video.duration_seconds,
    media_processing: deepClone(video.media_processing || {}),
    modified_time: video.modified_time,
    size: video.size,
  }));

  const hasCompleteStaticSet = group.imagens.length === SLOT_CONFIG.length;
  const hasSingleVerticalVideo = group.videos.length === 1;
  group.media_mode = hasCompleteStaticSet && hasSingleVerticalVideo
    ? 'mixed'
    : !group.imagens.length && hasSingleVerticalVideo
      ? 'video_only'
      : 'static_only';
  group.required_media_roles = group.media_mode === 'mixed'
    ? ['feed_image', 'banner_image', 'vertical_image', 'vertical_video']
    : group.media_mode === 'video_only'
      ? ['vertical_video']
      : ['feed_image', 'banner_image', 'vertical_image'];
  group.available_ratios = uniqueStrings(group.all_candidates.map((candidate) => candidate.proporcao));
  group.required_ratios = group.media_mode === 'video_only' ? [] : getRequiredRatiosForGroup(group);
  group.grupo_completo = group.media_mode === 'mixed'
    ? hasCompleteStaticSet && hasSingleVerticalVideo
    : group.media_mode === 'video_only'
      ? hasSingleVerticalVideo
      : !requiresVideo && hasCompleteStaticSet;
  group.missing_ratios = group.media_mode === 'video_only' ? [] : SLOT_CONFIG
    .filter((config) => !group.imagens.some((image) => config.acceptedRatios.includes(safeString(image.proporcao))))
    .map((config) => config.acceptedRatios.join('|'));
  group.duplicate_ratios = duplicate_ratios;
  if (group.video_candidates.length > 1) group.duplicate_ratios.vertical_video = group.video_candidates.map((candidate) => candidate.original_name);
  if ((requiresVideo || group.video_candidates.length) && group.videos.length !== 1) group.missing_ratios.push('vertical_video:9x16');

  candidateGroupDebug.push({
    group_key: group.group_key,
    offer_group_key: group.offer_group_key,
    creative_group_key: group.creative_group_key,
    grouping_discriminator: group.grouping_discriminator,
    grouping_strategy: group.grouping_strategy,
    nome_base: group.nome_base,
    suffix_hint,
    ratios_found: group.available_ratios,
    required_ratios: group.required_ratios,
    media_mode: group.media_mode,
    required_media_roles: group.required_media_roles,
    missing_ratios: group.missing_ratios,
    duplicate_ratios: group.duplicate_ratios,
    videos_found: group.video_candidates.map((candidate) => `${candidate.proporcao}:${candidate.original_name}`),
    slot_candidates: Object.fromEntries(
      Object.entries(group.candidates_by_slot).map(([slot, list]) => [
        slot,
        safeArray(list).map((candidate) => `${candidate.proporcao}:${candidate.original_name}`),
      ])
    ),
  });

  if (group.grupo_completo) {
    groupedCreatives.push(group);
  }
}

if (!driveItems.length) {
  return buildFailure({
    drive_items_found: 0,
    destinations_found: destinations.length,
    candidate_groups_built: groups.size,
    complete_groups_found: groupedCreatives.length,
    groups: candidateGroupDebug,
  }, 'Nenhum item de Drive foi encontrado no Merge de entrada.');
}

if (!groupedCreatives.length) {
  return buildFailure({
    drive_items_found: driveItems.length,
    destinations_found: destinations.length,
    candidate_groups_built: groups.size,
    complete_groups_found: 0,
    groups: candidateGroupDebug,
  }, 'Nenhum grupo completo foi montado.');
}

const incompleteGroups = candidateGroupDebug.filter((candidate) => safeArray(candidate.missing_ratios).length);
const duplicateGroups = candidateGroupDebug.filter((candidate) => Object.keys(candidate.duplicate_ratios || {}).length);
if (incompleteGroups.length || duplicateGroups.length || groupedCreatives.length !== groups.size) {
  return buildFailure({
    drive_items_found: driveItems.length,
    destinations_found: destinations.length,
    candidate_groups_built: groups.size,
    complete_groups_found: groupedCreatives.length,
    incomplete_groups: incompleteGroups,
    duplicate_groups: duplicateGroups,
    groups: candidateGroupDebug,
  }, 'O lote inteiro foi bloqueado porque existem grupos incompletos ou slots duplicados.');
}

const batchFiles = driveItems
  .map((item) => ({
    id: safeString(item.id),
    name: safeString(item.name),
    md5_checksum: safeString(item.md5Checksum || item.md5_checksum),
    modified_time: safeString(item.modifiedTime || item.modified_time),
    size: safeString(item.size),
    media_type: safeString(item.visual_grouping?.media_type || (safeString(item.mimeType || item.mime_type).startsWith('video/') ? 'video' : 'image')),
    checksum_sha256: safeString(item.media_processing?.output_checksum_sha256),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));
const configRevisions = uniqueStrings(destinations.map((destination) => destination.config_revision));
if (configRevisions.length !== 1) {
  return buildFailure({ config_revisions: configRevisions }, 'Os destinos nao compartilham a mesma revisao de configuracao do gateway.');
}

const normalizedSourceAds = sourceAds.map((ad) => {
  const searchText = buildAdSearchText(ad);
  const parsedNaming = parseStructuredCreativeNameFromText(searchText);

  return {
    raw: deepClone(ad),
    id: safeString(ad.id),
    name: safeString(ad.name),
    normalized_name: normalizeText(ad.name),
    compact_name: normalizeCompactKey(ad.name),
    tokens: tokenize(searchText),
    product_family: inferProductFamily(searchText),
    offer_markers: inferOfferMarkers(searchText),
    search_text: searchText,
    extracted_texts: extractCreativeTexts(ad),
    parsed_naming: parsedNaming ? deepClone(parsedNaming) : null,
    offer_fingerprint: legacyOfferFingerprint(ad),
  };
});

const outputs = [];

for (const group of groupedCreatives) {
  const binary = {};
  const warnings = [];
  const media_inventory = [];

  for (const image of group.imagens) {
    const binaryRef = pickResolvedBinary(binaryState, group, image);
    const binaryKey = binaryKeyForRatio(image.proporcao);

    media_inventory.push({
      id: image.id,
      source_file_id: image.id,
      name: image.name,
      original_name: image.original_name,
      media_type: 'image',
      role: image.role,
      proporcao: image.proporcao,
      binary_key: binaryKey,
      checksum_sha256: safeString(image.output_checksum_sha256 || image.md5_checksum),
      has_binary: Boolean(binaryRef && binaryRef.data),
    });

    if (binaryRef && binaryRef.data) {
      binary[binaryKey] = deepClone(binaryRef.data);
    } else {
      warnings.push(`Binario nao encontrado para ${image.original_name || image.name}`);
    }
  }

  for (const video of safeArray(group.videos)) {
    const binaryRef = pickResolvedBinary(binaryState, group, video);
    const binaryKey = binaryKeyForRole('vertical_video');
    media_inventory.push({
      id: video.id,
      source_file_id: video.id,
      name: video.name,
      original_name: video.original_name,
      media_type: 'video',
      role: 'vertical_video',
      proporcao: '9x16',
      binary_key: binaryKey,
      thumbnail_binary_key: 'thumbnail_vertical_video',
      checksum_sha256: video.output_checksum_sha256,
      thumbnail_checksum_sha256: video.thumbnail_checksum_sha256,
      duration_seconds: video.duration_seconds,
      media_processing: deepClone(video.media_processing || {}),
      has_binary: Boolean(binaryRef?.data),
      has_thumbnail: Boolean(binaryRef?.thumbnail),
    });
    if (binaryRef?.data) binary[binaryKey] = deepClone(binaryRef.data);
    else warnings.push(`Binario de video nao encontrado para ${video.original_name || video.name}`);
    if (binaryRef?.thumbnail) binary.thumbnail_vertical_video = deepClone(binaryRef.thumbnail);
    else warnings.push(`Miniatura de video nao encontrada para ${video.original_name || video.name}`);
  }

  const ratiosWithBinary = uniqueStrings(
    media_inventory.filter((item) => item.has_binary).map((item) => item.proporcao)
  );

  for (const ratio of group.required_ratios) {
    if (!ratiosWithBinary.includes(ratio)) {
      warnings.push(`Binario ausente para a proporcao ${ratio} em ${group.nome_base}`);
    }
  }

  const mediaInventoryByRatio = new Map(
    media_inventory.map((item) => [safeString(item.proporcao), item])
  );

  const matchedAds = normalizedSourceAds
    .map((ad) => {
      const decision = buildMatchDecision(group, ad);
      const offerDecision = compareOfferFingerprints(group.offer_fingerprint, ad.offer_fingerprint);
      return {
        ad_id: ad.id,
        ad_name: ad.name,
        score: decision.score,
        match_level: decision.match_level,
        match_reasons: decision.reasons,
        shared_tokens: decision.shared_tokens,
        exact_name_match: decision.exact_name_match,
        exact_token_match: decision.exact_token_match,
        parsed_naming_found: Boolean(ad.parsed_naming),
        parsed_offer_key: ad.parsed_naming ? ad.parsed_naming.offer_key : '',
        parsed_product_key: ad.parsed_naming ? ad.parsed_naming.product_key : '',
        offer_match_status: offerDecision.status,
        offer_match_source: offerDecision.source || '',
        offer_fingerprint: deepClone(ad.offer_fingerprint),
        source_ad: deepClone(ad.raw),
        source_ad_texts: deepClone(ad.extracted_texts),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.ad_name.localeCompare(b.ad_name));

  const replacementMatchedAds = matchedAds.filter((item) => item.offer_match_status === 'exact');
  const bestStructured = replacementMatchedAds.find((item) => item.match_level !== 'text_fallback');
  let selectedAds = [];

  if (bestStructured) {
    const structuredPriority = {
      offer_key_exact: 6,
      product_plus_offer: 5,
      product_only: 4,
      product_family_offer_fit: 3,
      product_family_soft: 2,
      text_fallback: 1,
      none: 0,
    };

    const bestLevelScore = structuredPriority[bestStructured.match_level] || 0;
    selectedAds = replacementMatchedAds.filter((item) => (structuredPriority[item.match_level] || 0) === bestLevelScore);

    if (selectedAds.length > 1) {
      const topStructuredScore = selectedAds[0].score;
      selectedAds = selectedAds.filter((item) => item.score >= topStructuredScore - 10);
    }
  } else {
    const topScore = replacementMatchedAds.length ? replacementMatchedAds[0].score : 0;
    selectedAds = replacementMatchedAds.filter((item) => {
      if (item.exact_name_match) return true;
      if (item.exact_token_match && item.score >= 12) return true;
      if (topScore > 0 && item.score >= Math.max(12, topScore - 4)) return true;
      return false;
    });
  }

  selectedAds = limitSelectedAdsForSafety(selectedAds, destinations);

  if (!group.parsed_naming) {
    warnings.push(`Nome do criativo fora do padrao estruturado: ${group.nome_base}`);
  }

  if (!selectedAds.length) {
    warnings.push(`Nenhum anuncio substituivel com oferta comercial identica encontrado para ${group.nome_base}; ${group.offer_fingerprint.replacement_eligible ? 'offer_fingerprint_mismatch' : 'offer_fingerprint_unverified'}.`);
  }

  if (selectedAds.length > 3) {
    warnings.push(`Match amplo para ${group.nome_base}: ${selectedAds.length} anuncios selecionados`);
  }

  const primaryMatchedAd = selectedAds.length ? selectedAds[0] : null;
  const matchStatus = primaryMatchedAd ? primaryMatchedAd.match_level : 'no_match';

  const replaceEligibleLevels = group.suffix_hint === 'campaign'
    ? ['offer_key_exact', 'product_plus_offer', 'product_only', 'product_family_offer_fit']
    : ['offer_key_exact'];

  const shouldReplaceExisting =
    group.offer_fingerprint.replacement_eligible === true &&
    Boolean(primaryMatchedAd) &&
    replaceEligibleLevels.includes(matchStatus) &&
    primaryMatchedAd.score >= 380;

  const selectedAdsForReplace = shouldReplaceExisting ? selectedAds : [];
  const primarySelectedAd = shouldReplaceExisting ? primaryMatchedAd : null;

  const replacementPlan = shouldReplaceExisting
    ? selectedAdsForReplace.flatMap((matched) =>
        buildReplacementPlanForAd(matched.source_ad, mediaInventoryByRatio)
      )
    : [];

  const selectedAdIds = uniqueStrings(selectedAdsForReplace.map((item) => item.ad_id));

  if (shouldReplaceExisting && selectedAdsForReplace.length && !replacementPlan.length) {
    warnings.push(`Foram encontrados anuncios para ${group.nome_base}, mas nenhuma regra de substituicao pode ser inferida`);
  }

  const replacementRatiosCovered = uniqueStrings(replacementPlan.map((item) => item.ratio));
  for (const ratio of group.required_ratios) {
    if (shouldReplaceExisting && !replacementRatiosCovered.includes(ratio)) {
      warnings.push(`Nenhum destino de substituicao inferido para a proporcao ${ratio} em ${group.nome_base}`);
    }
  }

  const sourceAd = primarySelectedAd ? primarySelectedAd.source_ad : null;
  const sourceAdTexts = primaryMatchedAd
    ? buildSourceAdTexts(primaryMatchedAd.source_ad)
    : { titles: [], bodies: [], descriptions: [] };

  const sourceAdNameOriginal = primaryMatchedAd
    ? safeString(primaryMatchedAd.ad_name)
    : '';

  const sourceAdNameBase = safeString(group.nome_base);

  const sourceAdNameReference =
    sourceAdNameBase ||
    sourceAdNameOriginal;

  const action = shouldReplaceExisting ? 'replace_existing' : 'create_new';

  const resolvedDestinations = destinations.map((destination) => {
    const destinationCampaignId = safeString(destination.campaign_id || destination.destination_campaign_id);
    const destinationAdsetId = safeString(destination.adset_id || destination.destination_adset_id);
    const placementCheck = placementCheckForDestination(destination);

    const destinationWarnings = [
      ...(destinationCampaignId ? [] : ['Campaign ID nao encontrado para o destination atual.']),
      ...(destinationAdsetId ? [] : ['AdSet ID nao encontrado para o destination atual.']),
    ];

    return {
      destination_group: safeString(destination.destination_group),
      destination_row_number: safeString(destination.row_number || destination.destination_row_number),
      destination_campaign_id: destinationCampaignId,
      destination_ad_account_id: safeString(destination.account_id || destination.destination_ad_account_id),
      destination_page_id: safeString(destination.page_id || destination.destination_page_id),
      destination_instagram_user_id: safeString(destination.instagram_user_id || destination.destination_instagram_user_id),
      destination_adset_id: destinationAdsetId,
      destination_api_version: safeString(destination.api_version || destination.destination_api_version || 'v25.0'),
      token_id: safeString(destination.token_id),
      allowed_link_hosts: safeArray(destination.allowed_link_hosts),
      landing_pages_by_creative_group: deepClone(destination.landing_pages_by_creative_group || {}),
      landing_page_validation: deepClone(destination.landing_page_validation || {}),
      placement_eligibility: deepClone(placementCheck || {}),
      freshness_window_days: Number(destination.freshness_window_days || 7),
      campaign_objective: safeString(destination.campaign_objective),
      optimization_goal: safeString(destination.optimization_goal),
      destination_type: safeString(destination.destination_type).toUpperCase(),
      config_revision: safeString(destination.config_revision),
      destination_id_source: 'token_vault',
      suffix_hint: group.suffix_hint,
      warnings: destinationWarnings,
    };
  });

  for (const destination of resolvedDestinations) {
    const landingPages = destination.landing_pages_by_creative_group && typeof destination.landing_pages_by_creative_group === 'object'
      ? destination.landing_pages_by_creative_group
      : {};
    const exactLandingKeys = Object.keys(landingPages)
      .filter((key) => normalizeLandingPageKey(key) === normalizeLandingPageKey(group.creative_group_key));
    const defaultLandingKeys = Object.keys(landingPages)
      .filter((key) => ['DEFAULT', 'ALL'].includes(normalizeLandingPageKey(key)) || safeString(key) === '*');
    const uniqueLandingUrls = uniqueStrings(Object.values(landingPages));
    const matchingLandingKeys = exactLandingKeys.length
      ? exactLandingKeys
      : defaultLandingKeys.length
        ? defaultLandingKeys
        : uniqueLandingUrls.length === 1
          ? [Object.keys(landingPages).find((key) => safeString(landingPages[key]) === uniqueLandingUrls[0])]
          : [];
    if (matchingLandingKeys.length !== 1) {
      buildFailure({
        creative_group_key: group.creative_group_key,
        destination_group: destination.destination_group,
        configured_landing_page_keys: Object.keys(landingPages).map(normalizeLandingPageKey),
      }, matchingLandingKeys.length
        ? 'Landing page ambigua para o grupo criativo; lote bloqueado antes de upload e IA.'
        : 'Landing page ausente para o grupo criativo e sem fallback seguro do destino; lote bloqueado antes de upload e IA.');
    }
  }

  for (const destination of resolvedDestinations) {
    warnings.push(...safeArray(destination.warnings));
  }

  if (
    resolvedDestinations.length > 1 &&
    sourceAdNameOriginal &&
    sourceAdNameOriginal.includes('|')
  ) {
    warnings.push(
      `source_ad_name original continha unidade e foi neutralizado para evitar duplicacao por destino: ${sourceAdNameOriginal}`
    );
  }

  if (!resolvedDestinations.length) {
    warnings.push(`Nenhum destino foi reconhecido no input para ${group.nome_base}`);
  }

  const primaryDestination = resolvedDestinations.length === 1 ? resolvedDestinations[0] : {};
  const primaryDestinationStrategy = resolvedDestinations.length === 1 ? 'single_destination_only' : 'destinations_array_only';
  const jobKey = createJobKey([group.group_key, group.suffix_hint || 'base']);

  outputs.push({
    json: {
      job_key: jobKey,
      action,
      match_status: matchStatus,
      should_create_new_ad: action === 'create_new',
      should_replace_existing: action === 'replace_existing',

      nome_base: group.nome_base,
      group_key: group.group_key,
      offer_group_key: group.offer_group_key,
      creative_group_key: group.creative_group_key,
      grouping_discriminator: group.grouping_discriminator,
      grouping_strategy: group.grouping_strategy,
      product_key: group.product_key,
      product_family: group.product_family,
      offer_markers: group.offer_markers,
      offer_fingerprint: deepClone(group.offer_fingerprint),
      suffix_hint: group.suffix_hint,

      source_ad_id: sourceAd ? safeString(sourceAd.id) : '',
      source_ad_name: sourceAdNameReference,
      source_ad_name_base: sourceAdNameBase,
      source_ad_name_original: sourceAdNameOriginal,
      source_ad_texts: sourceAdTexts,

      naming: {
        parsed: Boolean(group.parsed_naming),
        product_key: group.product_key,
        item_key: group.item_key,
        presentation: group.presentation,
        area: group.area,
        offer_type: group.offer_type,
        offer_detail: group.offer_detail,
        payment_term: group.payment_term,
        offer_key: group.offer_key,
        format: group.format,
        creative_type: group.creative_type,
        campaign_key: group.parsed_naming ? safeString(group.parsed_naming.campaign_key) : '',
        creative_group_key: group.creative_group_key,
        offer_group_key: group.offer_group_key,
        grouping_discriminator: group.grouping_discriminator,
        grouping_strategy: group.grouping_strategy,
        product_family: group.product_family,
        offer_markers: group.offer_markers,
        offer_fingerprint: deepClone(group.offer_fingerprint),
        suffix_hint: group.suffix_hint,
      },

      imagens: deepClone(group.imagens),
      videos: deepClone(group.videos),
      media_mode: group.media_mode,
      required_media_roles: deepClone(group.required_media_roles),
      available_ratios: group.available_ratios,
      required_ratios: group.required_ratios,
      missing_ratios: group.missing_ratios,
      grupo_completo: group.grupo_completo,
      media_inventory,

      destinations: resolvedDestinations.map((destination) => ({
        destination_group: destination.destination_group,
        destination_row_number: destination.destination_row_number,
        destination_campaign_id: destination.destination_campaign_id,
        destination_ad_account_id: destination.destination_ad_account_id,
        destination_page_id: destination.destination_page_id,
        destination_instagram_user_id: destination.destination_instagram_user_id,
        destination_adset_id: destination.destination_adset_id,
        destination_api_version: destination.destination_api_version,
        token_id: destination.token_id,
        allowed_link_hosts: destination.allowed_link_hosts,
        landing_pages_by_creative_group: destination.landing_pages_by_creative_group,
        landing_page_validation: destination.landing_page_validation,
        placement_eligibility: destination.placement_eligibility,
        freshness_window_days: destination.freshness_window_days,
        campaign_objective: destination.campaign_objective,
        optimization_goal: destination.optimization_goal,
        destination_type: destination.destination_type,
        config_revision: destination.config_revision,
        destination_id_source: destination.destination_id_source,
        suffix_hint: destination.suffix_hint,
        warnings: destination.warnings,
      })),

      destinations_count: resolvedDestinations.length,
      destination_groups: uniqueStrings(resolvedDestinations.map((d) => d.destination_group)),
      primary_destination_strategy: primaryDestinationStrategy,
      primary_destination_available: resolvedDestinations.length === 1,

      destination_group: safeString(primaryDestination.destination_group),
      destination_row_number: safeString(primaryDestination.destination_row_number),
      destination_campaign_id: safeString(primaryDestination.destination_campaign_id),
      destination_ad_account_id: safeString(primaryDestination.destination_ad_account_id),
      destination_page_id: safeString(primaryDestination.destination_page_id),
      destination_instagram_user_id: safeString(primaryDestination.destination_instagram_user_id),
      destination_adset_id: safeString(primaryDestination.destination_adset_id),
      destination_api_version: safeString(primaryDestination.destination_api_version),

      account_id: safeString(primaryDestination.destination_ad_account_id),
      api_version: safeString(primaryDestination.destination_api_version),
      page_id: safeString(primaryDestination.destination_page_id),
      instagram_user_id: safeString(primaryDestination.destination_instagram_user_id),
      row_number: safeString(primaryDestination.destination_row_number),

      matched_ads: matchedAds.map((item) => ({
        ad_id: item.ad_id,
        ad_name: item.ad_name,
        score: item.score,
        match_level: item.match_level,
        match_reasons: item.match_reasons,
        shared_tokens: item.shared_tokens,
        exact_name_match: item.exact_name_match,
        exact_token_match: item.exact_token_match,
        parsed_naming_found: item.parsed_naming_found,
        parsed_offer_key: item.parsed_offer_key,
        parsed_product_key: item.parsed_product_key,
        offer_match_status: item.offer_match_status,
        offer_match_source: item.offer_match_source,
        created_time: safeString(item.source_ad && item.source_ad.created_time),
        updated_time: safeString(item.source_ad && item.source_ad.updated_time),
        creative_created_time: safeString(item.source_ad && item.source_ad.creative && item.source_ad.creative.created_time),
        creative_updated_time: safeString(item.source_ad && item.source_ad.creative && item.source_ad.creative.updated_time),
      })),

      selected_ad_ids: selectedAdIds,
      selected_ads: selectedAdsForReplace.map((item) => ({
        ad_id: item.ad_id,
        ad_name: item.ad_name,
        score: item.score,
        match_level: item.match_level,
        parsed_offer_key: item.parsed_offer_key,
        parsed_product_key: item.parsed_product_key,
        offer_match_status: item.offer_match_status,
        created_time: safeString(item.source_ad && item.source_ad.created_time),
        updated_time: safeString(item.source_ad && item.source_ad.updated_time),
        creative_created_time: safeString(item.source_ad && item.source_ad.creative && item.source_ad.creative.created_time),
        creative_updated_time: safeString(item.source_ad && item.source_ad.creative && item.source_ad.creative.updated_time),
      })),

      replacement_plan: deepClone(replacementPlan),

      related_ids: {
        drive_file_ids: uniqueStrings([...group.imagens, ...safeArray(group.videos)].map((media) => media.id)),
        matched_ad_ids: uniqueStrings(matchedAds.map((item) => item.ad_id)),
        selected_ad_ids: selectedAdIds,
        replacement_ad_ids: uniqueStrings(replacementPlan.map((item) => item.ad_id)),
        replacement_creative_ids: uniqueStrings(replacementPlan.map((item) => item.creative_id)),
        destination_campaign_ids: uniqueStrings(resolvedDestinations.map((item) => item.destination_campaign_id)),
        destination_adset_ids: uniqueStrings(resolvedDestinations.map((item) => item.destination_adset_id)),
        destination_page_ids: uniqueStrings(resolvedDestinations.map((item) => item.destination_page_id)),
        destination_instagram_user_ids: uniqueStrings(resolvedDestinations.map((item) => item.destination_instagram_user_id)),
        destination_ad_account_ids: uniqueStrings(resolvedDestinations.map((item) => item.destination_ad_account_id)),
      },

      source_ads: deepClone(sourceAds),
      batch_files: deepClone(batchFiles),
      config_revision: configRevisions[0],

      debug_grouping: {
        drive_items_in_group: group.all_candidates.length,
        creative_group_key: group.creative_group_key,
        offer_group_key: group.offer_group_key,
        grouping_discriminator: group.grouping_discriminator,
        grouping_strategy: group.grouping_strategy,
        candidate_groups_built: groups.size,
        complete_groups_found: groupedCreatives.length,
        incomplete_groups: candidateGroupDebug.filter((candidate) => safeArray(candidate.missing_ratios).length),
        selected_ratios: group.imagens.map((image) => image.proporcao),
        selected_media_roles: [...group.imagens, ...safeArray(group.videos)].map((media) => media.role),
        available_ratios: group.available_ratios,
        missing_ratios: group.missing_ratios,
        duplicate_ratios: group.duplicate_ratios,
        suffix_hints_found: uniqueStrings(group.suffix_hints_found),
        destinations_found_in_input: destinations.length,
      },

      warnings: uniqueStrings(warnings),
    },
    binary: deepClone(binary),
  });
}

if (!outputs.length) {
  return buildFailure({
    drive_items_found: driveItems.length,
    destinations_found: destinations.length,
    candidate_groups_built: groups.size,
    complete_groups_found: groupedCreatives.length,
    groups: candidateGroupDebug,
  }, 'Nenhum grupo completo foi montado.');
}

return outputs;
