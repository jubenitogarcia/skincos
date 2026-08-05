'use strict';

const {
  consentVerified,
  firstDefined,
  object,
  sha256,
  stableId,
  text,
} = require('../contracts');

function adapterError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function visualPrompt(job) {
  const candidate = object(job);
  const value = text(firstDefined(candidate.visual_prompt, candidate.generation_prompt, candidate.scene_description, candidate.prompt));
  if (!value) return 'Create a clean, brand-neutral visual base with no commercial claims.';
  if (/(?:logo|logomarca|watermark|marca d.?água|headline|copy|cta|call\s*to\s*action|price|preço|disclaimer|disclaimer|texto comercial|commercial text)/i.test(value)) {
    throw adapterError('BASE_PROMPT_CONTAINS_COMMERCIAL_OVERLAY', 'Image generation prompt contains a commercial overlay or logo instruction');
  }
  return `${value}. Produce only the clean visual base. Do not include any text, logo, watermark, price, CTA, disclaimer, product claim, or commercial typography.`;
}

async function readImageData(response, fetchImpl = globalThis.fetch) {
  const payload = await response.json();
  const item = Array.isArray(payload.data) ? payload.data[0] || {} : {};
  if (text(item.b64_json)) return Buffer.from(item.b64_json, 'base64');
  if (text(item.url)) {
    if (typeof fetchImpl !== 'function') throw adapterError('FETCH_UNAVAILABLE', 'The executor runtime does not provide fetch');
    const imageResponse = await fetchImpl(item.url);
    if (!imageResponse.ok) throw adapterError('IMAGE_DOWNLOAD_FAILED', `OpenAI image download failed with HTTP ${imageResponse.status}`, { statusCode: imageResponse.status, retryable: imageResponse.status >= 500 || imageResponse.status === 429 });
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  throw adapterError('IMAGE_OUTPUT_MISSING', 'OpenAI image response did not include an image URL or image payload');
}

class OpenAIImageAdapter {
  constructor({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-image-1', configuredCost, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = text(apiKey);
    this.baseUrl = text(baseUrl).replace(/\/$/, '');
    this.model = text(model || 'gpt-image-1');
    this.configuredCost = configuredCost === undefined || configuredCost === '' ? null : Number(configuredCost);
    this.fetchImpl = fetchImpl;
  }

  supports(capability) {
    return capability === 'image_generation';
  }

  async execute({ job, manifest, context }) {
    if (!this.apiKey) throw adapterError('OPENAI_API_KEY_MISSING', 'OpenAI image generation is not configured');
    if (typeof this.fetchImpl !== 'function') throw adapterError('FETCH_UNAVAILABLE', 'The executor runtime does not provide fetch');
    if (!consentVerified(job, context, manifest)) throw adapterError('CONSENT_REQUIRED', 'Identifiable imagery requires verified consent');
    const cost = Number.isFinite(Number(job.estimated_cost)) ? Number(job.estimated_cost) : this.configuredCost;
    if (!Number.isFinite(cost) || cost < 0) throw adapterError('COST_UNCONFIGURED', 'Live image generation requires a configured cost');
    const prompt = visualPrompt(job);
    const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        size: text(job.size || '1024x1024'),
        output_format: 'png',
      }),
    });
    if (!response.ok) {
      throw adapterError(response.status === 429 ? 'RATE_LIMIT' : 'OPENAI_IMAGE_REQUEST_FAILED', `OpenAI image generation failed with HTTP ${response.status}`, {
        statusCode: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const bytes = await readImageData(response, this.fetchImpl);
    const providerJobId = text(response.headers && response.headers.get && response.headers.get('x-request-id')) || stableId('openai-image', { job_id: job.job_id, digest: sha256(bytes) });
    return {
      provider_job_id: providerJobId,
      outputs: [{
        artifact_key: text(job.expected_artifacts?.[0]?.artifact_key || 'primary'),
        bytes,
        metadata: {
          mime_type: 'image/png',
          width: Number(job.width) > 0 ? Number(job.width) : 1024,
          height: Number(job.height) > 0 ? Number(job.height) : 1024,
          duration_seconds: null,
        },
      }],
      cost,
      currency: text(job.currency || 'USD'),
      warnings: [],
      provenance: {
        adapter: 'openai-images',
        model: this.model,
        prompt_sha256: sha256(prompt),
        base_visual_only: true,
        overlays_applied: false,
      },
    };
  }
}

module.exports = {
  OpenAIImageAdapter,
  visualPrompt,
};
