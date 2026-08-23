const MODULES = [
  { code: 'CCG-00', id: 'ccg-v2-content-orchestrator', name: 'Campaign Creative Generator (Unified)', output: 'content_package' },
  { code: 'CCG-10', id: 'ccg-v2-grounding', name: 'CCG-10 Grounding', output: 'factual_foundation' },
  { code: 'CCG-20', id: 'ccg-v2-strategy', name: 'CCG-20 Strategy', output: 'content_constitution' },
  { code: 'CCG-30', id: 'ccg-v2-preproduction', name: 'CCG-30 Preproduction', output: 'creative_blueprint' },
  { code: 'CCG-40', id: 'ccg-v2-asset-factory', name: 'CCG-40 Asset Factory', output: 'asset_manifest' },
  { code: 'CCG-50', id: 'ccg-v2-scene-factory', name: 'CCG-50 Scene Factory', output: 'scene_manifest' },
  { code: 'CCG-60', id: 'ccg-v2-audio-factory', name: 'CCG-60 Audio Factory', output: 'audio_manifest' },
  { code: 'CCG-70', id: 'ccg-v2-assembly', name: 'CCG-70 Assembly', output: 'timeline' },
  { code: 'CCG-80', id: 'ccg-v2-finalization', name: 'CCG-80 Finalization', output: 'production_manifest' },
  { code: 'CCG-90', id: 'ccg-v2-qa-package', name: 'CCG-90 QA and Package', output: 'content_package' },
  { code: 'CCG-99', id: 'ccg-v2-error-handler', name: 'CCG-99 Error Handler', output: 'error' },
];
module.exports = { MODULES };
