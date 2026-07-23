function text(value) { return String(value ?? '').trim().toLowerCase(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function values(targeting, configuredKey, effectiveKey) {
  const effective = list(targeting[effectiveKey]).map(text).filter(Boolean);
  return effective.length ? effective : list(targeting[configuredKey]).map(text).filter(Boolean);
}
function includesAny(actual, expected) { return expected.some((value) => actual.includes(value)); }
function missing(actual, expected) { return expected.filter((value) => !actual.includes(value)); }

const failures = [];
const outputs = [];
for (const item of $input.all()) {
  const root = object(item.json);
  if (root.ok !== true) throw new Error(`Meta placement preflight sem inventario valido: ${JSON.stringify(root.error || root.detail || {})}`);
  const checks = list(root.placement_checks);
  if (!checks.length) throw new Error('Meta placement preflight nao recebeu adsets para validar.');
  const normalizedChecks = [];

  for (const entry of checks) {
    const targeting = object(entry && entry.targeting);
    const publishers = values(targeting, 'publisher_platforms', 'effective_publisher_platforms');
    const facebook = values(targeting, 'facebook_positions', 'effective_facebook_positions');
    const instagram = values(targeting, 'instagram_positions', 'effective_instagram_positions');
    const audienceNetwork = values(targeting, 'audience_network_positions', 'effective_audience_network_positions');
    const whatsapp = values(targeting, 'whatsapp_positions', 'effective_whatsapp_positions');
    const problems = [];

    problems.push(...missing(publishers, ['facebook', 'instagram', 'audience_network', 'whatsapp']).map((value) => `publisher:${value}`));
    if (!includesAny(facebook, ['instream_video', 'instream_reel'])) problems.push('facebook:instream_video');
    if (!facebook.includes('story')) problems.push('facebook:story');
    if (!includesAny(facebook, ['facebook_reels', 'fb_reels'])) problems.push('facebook:facebook_reels');
    if (!facebook.includes('feed')) problems.push('facebook:feed');
    if (!facebook.includes('search')) problems.push('facebook:search');
    problems.push(...missing(instagram, ['story', 'reels']).map((value) => `instagram:${value}`));
    if (!audienceNetwork.includes('classic')) problems.push('audience_network:classic');
    if (!whatsapp.some((value) => value.includes('status'))) problems.push('whatsapp:status');

    if (problems.length) {
      failures.push({
        destination_group: String(entry && entry.destination_group || ''),
        adset_id_present: Boolean(String(entry && entry.adset_id || '')),
        missing_effective_placements: problems,
      });
    }

    normalizedChecks.push({
      ...entry,
      advantage_plus_eligibility: {
        instagram_static_image_music: publishers.includes('instagram') && includesAny(instagram, ['story', 'reels', 'stream']),
        effective_instagram_positions: instagram,
        effective_publisher_platforms: publishers,
      },
    });
  }

  outputs.push({
    ...item,
    json: {
      ...root,
      placement_checks: normalizedChecks,
      placement_preflight: {
        status: 'ok',
        checked_adsets: checks.length,
        required_vertical_crop: '90x160',
        required_horizontal_crop: '191x100',
        required_horizontal_placement: 'facebook:search',
      },
    },
  });
}

if (failures.length) {
  throw new Error(`Meta placement preflight bloqueou o lote: ${JSON.stringify(failures)}`);
}

return outputs;
