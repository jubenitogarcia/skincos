'use strict';

const {
  firstDefined,
  object,
  sha256,
  stableId,
  text,
} = require('../contracts');

function escapeXml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function overlayFor(job) {
  const candidate = object(job);
  const overlay = object(firstDefined(candidate.overlay, candidate.overlays, candidate.deterministic_overlay, candidate.copy_overlay));
  return {
    copy: text(firstDefined(overlay.copy, overlay.headline, candidate.copy, candidate.headline)),
    cta: text(firstDefined(overlay.cta, candidate.cta)),
    price: text(firstDefined(overlay.price, candidate.price)),
    disclaimer: text(firstDefined(overlay.disclaimer, candidate.disclaimer)),
    logo_uri: text(firstDefined(overlay.logo_uri, overlay.logo, candidate.logo_uri, candidate.logo_asset_uri)),
  };
}

function baseVisualUri(job, context) {
  const candidate = object(job);
  const dependency = object(context && context.dependencyArtifacts && context.dependencyArtifacts[0]);
  return text(firstDefined(
    candidate.base_visual_uri,
    candidate.base_image_uri,
    candidate.input_artifact_uri,
    candidate.source_uri,
    dependency.artifact_uri,
    dependency.uri,
  ));
}

function renderSvg(job, context = {}) {
  const candidate = object(job);
  const overlay = overlayFor(candidate);
  const width = number(firstDefined(candidate.width, object(candidate.output_spec).width, object(candidate.dimensions).width), 1080);
  const height = number(firstDefined(candidate.height, object(candidate.output_spec).height, object(candidate.dimensions).height), 1080);
  const background = text(candidate.background_color || '#F6F1EB');
  const baseUri = baseVisualUri(candidate, context);
  const logo = overlay.logo_uri
    ? `<image href="${escapeXml(overlay.logo_uri)}" x="${Math.round(width * 0.78)}" y="${Math.round(height * 0.04)}" width="${Math.round(width * 0.16)}" height="${Math.round(height * 0.12)}" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  const base = baseUri
    ? `<image href="${escapeXml(baseUri)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`;
  const textElements = [
    overlay.copy ? `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.74)}" font-family="Arial, sans-serif" font-size="${Math.max(20, Math.round(width * 0.045))}" font-weight="700" fill="#1A1A1A">${escapeXml(overlay.copy)}</text>` : '',
    overlay.price ? `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.82)}" font-family="Arial, sans-serif" font-size="${Math.max(18, Math.round(width * 0.035))}" fill="#1A1A1A">${escapeXml(overlay.price)}</text>` : '',
    overlay.cta ? `<rect x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.84)}" width="${Math.round(width * 0.34)}" height="${Math.round(height * 0.1)}" rx="${Math.round(height * 0.02)}" fill="#2D6A4F" fill-opacity="0.95"/>` : '',
    overlay.cta ? `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.9)}" font-family="Arial, sans-serif" font-size="${Math.max(18, Math.round(width * 0.03))}" font-weight="700" fill="#FFFFFF">${escapeXml(overlay.cta)}</text>` : '',
    overlay.disclaimer ? `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.97)}" font-family="Arial, sans-serif" font-size="${Math.max(10, Math.round(width * 0.014))}" fill="#1A1A1A">${escapeXml(overlay.disclaimer)}</text>` : '',
  ].filter(Boolean).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    base,
    '<rect x="0" y="0" width="100%" height="100%" fill="none" stroke="#D8D0C8"/>',
    logo,
    textElements,
    '</svg>',
  ].join('');
}

class DeterministicRendererAdapter {
  constructor({ provider = 'deterministic-renderer' } = {}) {
    this.provider = provider;
  }

  supports(capability) {
    return ['image_composition', 'still_frame_rendering', 'temporal_video_rendering'].includes(capability);
  }

  async execute({ job, dependencyArtifacts = [] }) {
    const candidate = object(job);
    const overlay = overlayFor(candidate);
    if (candidate.logo_required === true && !overlay.logo_uri) {
      const error = new Error('A deterministic logo reference is required; logo generation is not allowed');
      error.code = 'LOGO_REFERENCE_REQUIRED';
      error.retryable = false;
      throw error;
    }
    const svg = renderSvg(candidate, { dependencyArtifacts });
    const digest = sha256(svg);
    const duration = Number.isFinite(Number(candidate.duration_seconds)) ? Number(candidate.duration_seconds) : null;
    return {
      provider_job_id: stableId('deterministic-render', { job_id: candidate.job_id, revision: candidate.revision, digest }),
      outputs: [{
        artifact_key: text(candidate.expected_artifacts?.[0]?.artifact_key || 'primary'),
        bytes: Buffer.from(svg, 'utf8'),
        metadata: {
          mime_type: 'image/svg+xml',
          width: number(firstDefined(candidate.width, candidate.output_spec?.width, candidate.dimensions?.width), 1080),
          height: number(firstDefined(candidate.height, candidate.output_spec?.height, candidate.dimensions?.height), 1080),
          duration_seconds: duration,
        },
      }],
      cost: 0,
      currency: 'BRL',
      warnings: duration !== null && candidate.capability === 'temporal_video_rendering'
        ? ['MOCK_TEMPORAL_RENDER_IS_DETERMINISTIC_SVG_PREVIEW']
        : [],
      provenance: {
        adapter: 'deterministic-renderer',
        base_visual_only_before_overlay: true,
        overlays_applied_deterministically: true,
        logo_source: overlay.logo_uri ? 'provided_asset_uri' : 'none',
        input_artifact_uris: dependencyArtifacts.map((artifact) => text(artifact.artifact_uri || artifact.uri)).filter(Boolean),
      },
    };
  }
}

module.exports = {
  DeterministicRendererAdapter,
  escapeXml,
  overlayFor,
  renderSvg,
};
