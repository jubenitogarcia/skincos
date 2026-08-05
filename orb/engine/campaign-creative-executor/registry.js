'use strict';

const { CAPABILITIES, text } = require('./contracts');
const { MockAdapter } = require('./adapters/mock');
const { DeterministicRendererAdapter } = require('./adapters/renderer');
const { OpenAIImageAdapter } = require('./adapters/openai-images');
const { StorageReferenceAdapter } = require('./adapters/storage');

class AdapterRegistry {
  constructor() {
    this.entries = new Map();
  }

  register(provider, capabilities, adapter) {
    const name = text(provider);
    if (!name || !adapter || typeof adapter.execute !== 'function') throw new Error('Adapter registration is incomplete');
    for (const capability of capabilities) {
      this.entries.set(`${name}:${capability}`, { provider: name, adapter });
    }
    return this;
  }

  resolve(provider, capability) {
    const name = text(provider);
    const direct = this.entries.get(`${name}:${capability}`);
    if (direct) return direct;
    if (name.toLowerCase().startsWith('mock')) {
      const mock = this.entries.get(`mock:${capability}`);
      if (mock) return { ...mock, provider: name };
    }
    return null;
  }

  providersFor(capability) {
    return Array.from(this.entries.values())
      .filter((entry) => entry.adapter.supports(capability))
      .map((entry) => entry.provider)
      .filter((value, index, values) => values.indexOf(value) === index);
  }
}

function createDefaultRegistry(options = {}) {
  const registry = new AdapterRegistry();
  const all = CAPABILITIES.slice();
  registry.register('mock', all, new MockAdapter());
  registry.register('deterministic-renderer', ['image_composition', 'still_frame_rendering', 'temporal_video_rendering'], new DeterministicRendererAdapter());
  registry.register('local-storage', ['artifact_storage'], new StorageReferenceAdapter());
  registry.register('openai-images', ['image_generation'], new OpenAIImageAdapter({
    apiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
    baseUrl: options.openaiBaseUrl || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
    model: options.openaiImageModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    configuredCost: options.openaiImageCost ?? process.env.CCG_EXECUTOR_OPENAI_IMAGE_COST,
    fetchImpl: options.fetchImpl,
  }));
  return registry;
}

module.exports = {
  AdapterRegistry,
  createDefaultRegistry,
};
