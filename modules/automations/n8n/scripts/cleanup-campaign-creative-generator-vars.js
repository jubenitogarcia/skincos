#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.before-variable-cleanup.20260601.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.variable-cleanup.json');

const REMOVED_NAMES = [
  'execution_mode',
  'variation_mode',
  'image_model',
  'fallback_image_models',
  'brand',
  'compliance_note',
  'campaign_name',
  'source_drive_folder_id',
  'output_drive_folder_id',
];

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
}

function writeWorkflow(workflow) {
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = (workflow.nodes || []).find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function setInitialConfig(workflow) {
  getNode(workflow, 'Configuracao Inicial').parameters = {
    keepOnlySet: true,
    values: {
      string: [
        { name: 'campaign_folder', value: '06' },
        { name: 'source_folder_id', value: '16a48rrGRdxcF8NMH51Vf25PYVM4hFxHQ' },
        { name: 'output_folder_id', value: '1uZvk2fEzrKiDT2LHvwCbJR-B4fKdhA_Y' },
        { name: 'requested_formats', value: '["feed","stories","square","website_banner"]' },
      ],
      number: [
        { name: 'max_variations_per_format', value: 3 },
        { name: 'max_jobs_total', value: 30 },
        { name: 'max_source_files', value: 40 },
        { name: 'max_image_references', value: 8 },
        { name: 'max_pdf_chars', value: 12000 },
      ],
    },
    options: {},
  };
}

const prepareOrchestrationCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) {
  if (Array.isArray(value)) return value;
  const text = safeString(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; } catch {}
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}
function positiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
function isPlaceholder(value) {
  const text = safeString(value).toLowerCase();
  return !text || text.includes('substituir') || text.includes('placeholder');
}
const cfg = $('Configuracao Inicial').first().json || {};
const requested_formats = safeArray(cfg.requested_formats);
const source_folder_id = safeString(cfg.source_folder_id);
const output_folder_id = safeString(cfg.output_folder_id);
const errors = [];
if (isPlaceholder(source_folder_id)) errors.push('source_folder_id ausente ou placeholder');
if (isPlaceholder(output_folder_id)) errors.push('output_folder_id ausente ou placeholder');
if (errors.length) {
  throw new Error('Campaign Creative Generator preflight bloqueado: ' + errors.join('; '));
}
return [{
  json: {
    campaign_folder: safeString(cfg.campaign_folder) || '06',
    source_folder_id,
    output_folder_id,
    requested_formats: requested_formats.length ? requested_formats : ['feed','stories','square','website_banner'],
    max_variations_per_format: positiveInt(cfg.max_variations_per_format, 3, 1, 12),
    max_jobs_total: positiveInt(cfg.max_jobs_total, 30, 1, 120),
    max_source_files: positiveInt(cfg.max_source_files, 40, 1, 200),
    max_image_references: positiveInt(cfg.max_image_references, 8, 1, 20),
    max_pdf_chars: positiveInt(cfg.max_pdf_chars, 12000, 1000, 50000),
    unified_workflow_id: 'ccg-orchestrator-001',
    orchestrated_at: new Date().toISOString(),
  },
}];
`;

const finalReportCode = `
function safeString(value) { return String(value ?? '').trim(); }
const items = $input.all().map((item) => item.json || {});
const byStatus = {};
const byFormat = {};
for (const item of items) {
  const status = safeString(item.status || 'unknown');
  byStatus[status] = (byStatus[status] || 0) + 1;
  const format = safeString(item.format || 'unknown');
  byFormat[format] = (byFormat[format] || 0) + 1;
}
return [{
  json: {
    campaign_folder: safeString(($('Preparar Orquestracao').first().json || {}).campaign_folder),
    finished_at: new Date().toISOString(),
    summary: {
      total_assets: items.length,
      approved: byStatus.approved || 0,
      needs_review: byStatus.needs_review || 0,
      failed: byStatus.failed || 0,
      by_status: byStatus,
      by_format: byFormat,
    },
    assets: items,
  },
}];
`;

const prepareCampaignInputsCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) {
  if (Array.isArray(value)) return value;
  const text = safeString(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; } catch {}
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}
async function binaryBuffer(itemIndex, key) {
  if (this.helpers && this.helpers.getBinaryDataBuffer) {
    return await this.helpers.getBinaryDataBuffer(itemIndex, key);
  }
  const data = (($input.all()[itemIndex] || {}).binary || {})[key];
  if (!data || !data.data) return Buffer.alloc(0);
  return Buffer.from(data.data, 'base64');
}
function extractPdfText(filePath, maxChars) {
  const childProcess = require('child_process');
  const script = [
    'import sys',
    'from pathlib import Path',
    'path = Path(sys.argv[1])',
    'limit = int(sys.argv[2])',
    'text = ""',
    'try:',
    '    import pypdf',
    '    reader = pypdf.PdfReader(str(path))',
    '    text = "\\\\n".join([(page.extract_text() or "") for page in reader.pages])',
    'except Exception:',
    '    try:',
    '        import PyPDF2',
    '        reader = PyPDF2.PdfReader(str(path))',
    '        text = "\\\\n".join([(page.extract_text() or "") for page in reader.pages])',
    '    except Exception as exc:',
    '        text = "PDF_TEXT_EXTRACTION_FAILED: " + str(exc)',
    'print(text[:limit])',
  ].join('\\n');
  try {
    return childProcess.execFileSync('python3', ['-c', script, filePath, String(maxChars)], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    return 'PDF_TEXT_EXTRACTION_FAILED: ' + safeString(error.message);
  }
}

const cfg = $('Preparar Orquestracao').first().json || $('Configuracao Inicial').first().json || {};
const items = $input.all();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const maxImageReferences = Math.max(1, Math.min(20, Number(cfg.max_image_references || 8)));
const maxPdfChars = Math.max(1000, Math.min(50000, Number(cfg.max_pdf_chars || 12000)));
const runId = \`\${Date.now()}-\${crypto.randomBytes(4).toString('hex')}\`;
const materialFolder = path.join('/tmp', 'n8n-campaign-creative', runId);
fs.mkdirSync(materialFolder, { recursive: true });

const source_materials = [];
const binary = {};
let imageIndex = 0;

for (let i = 0; i < items.length; i++) {
  const item = items[i] || {};
  const json = item.json || {};
  const binaryKeys = Object.keys(item.binary || {});
  const binaryKey = binaryKeys[0] || 'data';
  const name = safeString(json.name || json.fileName || \`material-\${i + 1}\`);
  const mimeType = safeString(json.mimeType || ((item.binary || {})[binaryKey] || {}).mimeType);
  const filePath = path.join(materialFolder, name.replace(/[\\\\/:*?"<>|]+/g, '_'));
  let sha256 = '';
  let text_excerpt = '';
  const kind = mimeType.includes('pdf') || /\\.pdf$/i.test(name) ? 'pdf' : mimeType.startsWith('image/') ? 'image' : 'other';
  if (binaryKeys.length) {
    const buf = await binaryBuffer.call(this, i, binaryKey);
    fs.writeFileSync(filePath, buf);
    sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (kind === 'pdf') text_excerpt = extractPdfText(filePath, maxPdfChars);
    if (kind === 'image' && imageIndex < maxImageReferences) {
      const key = \`image_\${imageIndex + 1}\`;
      binary[key] = item.binary[binaryKey];
      imageIndex++;
    }
  }
  source_materials.push({
    id: safeString(json.id),
    name,
    mimeType,
    kind,
    size: safeString(json.size),
    sha256,
    local_path: filePath,
    text_excerpt: safeString(text_excerpt).slice(0, maxPdfChars),
    webViewLink: safeString(json.webViewLink),
    thumbnailLink: safeString(json.thumbnailLink),
  });
}

return [{
  json: {
    ...cfg,
    material_folder: materialFolder,
    source_materials,
    material_summary: {
      total_files: source_materials.length,
      images_attached: imageIndex,
      pdfs: source_materials.filter((item) => item.kind === 'pdf').length,
      images: source_materials.filter((item) => item.kind === 'image').length,
      pdf_chars_limit: maxPdfChars,
    },
  },
  binary,
}];
`;

const normalizeBriefCode = `
function safeString(value) { return String(value ?? '').trim(); }
let payload = {};
if (safeString($json.campaign_brief_json)) payload = JSON.parse($json.campaign_brief_json);
else payload = $json || {};
return [{ json: { ...payload } }];
`;

const buildVariationPlanCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) {
  if (Array.isArray(value)) return value;
  const text = safeString(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; } catch {}
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}
function slug(value) {
  return safeString(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'item';
}
function formatSpec(format) {
  const map = {
    feed: { size: '1024x1536', aspect_ratio: '3:4', objective: 'feed equilibrado e comercial' },
    stories: { size: '1024x1792', aspect_ratio: '9:16', objective: 'leitura imediata para stories/reels' },
    square: { size: '1024x1024', aspect_ratio: '1:1', objective: 'post quadrado sintetico' },
    website_banner: { size: '1536x1024', aspect_ratio: '3:2', objective: 'banner web horizontal claro' },
  };
  return map[format] || { size: '1024x1024', aspect_ratio: '1:1', objective: 'formato customizado' };
}
function hasConfirmedPrice(offer) {
  return /\\d/.test(safeString(offer.price)) && Number(offer.confidence || 0) >= 0.65;
}
function selectedOffersForVariation(variation, offers, groups) {
  if (!offers.length) return [];
  if (variation === 'combo') {
    const group = groups.find((item) => safeArray(item.offer_ids).length >= 2) || groups[0];
    if (group && safeArray(group.offer_ids).length) return offers.filter((offer) => group.offer_ids.includes(offer.offer_id)).slice(0, 4);
  }
  if (variation === 'preco') return offers.filter(hasConfirmedPrice).slice(0, 1);
  if (variation === 'secundaria') return offers.slice(1, 3);
  return offers.slice(0, variation === 'hero' ? 2 : 1);
}
function allowedVariations(offers, groups, maxPerFormat) {
  const out = ['hero'];
  if (offers.length) out.push('oferta_principal');
  if (groups.some((group) => safeArray(group.offer_ids).length >= 2) || offers.length >= 2) out.push('combo');
  if (offers.some(hasConfirmedPrice)) out.push('preco');
  if (offers.length) out.push('beneficio');
  if (offers.length > 1) out.push('secundaria');
  return [...new Set(out)].slice(0, maxPerFormat);
}
function buildPrompt(ctx) {
  const offersText = ctx.offers.map((offer) => [offer.title, offer.price, offer.conditions].filter(Boolean).join(' - ')).join('; ');
  return [
    'Voce e um Diretor de Arte Senior de Performance para Meta Ads, Social Media e Web.',
    'Crie exatamente 1 imagem final, premium, profissional e coerente com a campanha.',
    'Marca: Espaco Facial.',
    \`Campanha/pasta: \${ctx.campaign_folder}.\`,
    \`Formato: \${ctx.format} (\${ctx.spec.aspect_ratio}, tamanho recomendado \${ctx.spec.size}).\`,
    \`Variacao: \${ctx.variation_key}. Objetivo: \${ctx.objective}.\`,
    \`Conceito criativo: \${ctx.brief.concept || 'usar materiais da campanha'}.\`,
    \`Paleta: \${safeArray(ctx.brief.visual_identity && ctx.brief.visual_identity.palette).join(', ')}.\`,
    \`Tipografia/estilo: \${safeString(ctx.brief.visual_identity && ctx.brief.visual_identity.typography_style)}.\`,
    \`Elementos decorativos: \${safeArray(ctx.brief.visual_identity && ctx.brief.visual_identity.decorative_elements).join(', ')}.\`,
    \`Ofertas autorizadas: \${offersText || 'nenhuma oferta/preco confirmado; criar variacao institucional sem inventar preco'}.\`,
    \`Tom: \${ctx.brief.tone || 'premium, claro, comercial e responsavel'}.\`,
    'Compliance: nao prometer resultado garantido, nao usar antes/depois, nao explorar insegurancas. Avaliacao individual. Resultados variam.',
    'Selecione apenas informacoes legiveis para o formato. Nao tente colocar toda a campanha em uma arte.',
    'A imagem deve parecer parte de uma familia visual maior de variacoes.',
  ].filter(Boolean).join('\\n');
}

const input = $input.first().json || {};
const brief = input.campaign_brief || {};
const offers = safeArray(brief.offers);
const groups = safeArray(brief.offer_groups);
const requestedFormats = safeArray(input.requested_formats).length ? safeArray(input.requested_formats) : ['feed','stories','square','website_banner'];
const maxPerFormat = Math.max(1, Math.min(12, Number(input.max_variations_per_format || 3)));
const maxJobsTotal = Math.max(1, Math.min(120, Number(input.max_jobs_total || 30)));
const selectedVariations = allowedVariations(offers, groups, maxPerFormat);
const jobs = [];
let priority = 1;
for (const format of requestedFormats) {
  const spec = formatSpec(format);
  for (const variation_key of selectedVariations) {
    if (jobs.length >= maxJobsTotal) break;
    const selectedOffers = selectedOffersForVariation(variation_key, offers, groups);
    if (['oferta_principal','preco','beneficio'].includes(variation_key) && !selectedOffers.length) continue;
    const objectiveByVariation = {
      hero: 'entrada conceitual da campanha',
      oferta_principal: 'destacar a oferta principal com clareza',
      combo: 'agrupar ofertas compativeis sem poluir a arte',
      preco: 'dar foco comercial ao preco confirmado',
      beneficio: 'valorizar beneficio percebido sem promessa garantida',
      secundaria: 'dar espaco para oferta secundaria ou institucional',
    };
    const asset_id = \`\${slug(input.campaign_folder)}__\${format}__\${variation_key}__v1\`;
    const ctx = {
      campaign_folder: input.campaign_folder,
      format,
      variation_key,
      objective: objectiveByVariation[variation_key] || spec.objective,
      spec,
      brief,
      offers: selectedOffers,
    };
    jobs.push({
      asset_id,
      campaign_folder: input.campaign_folder,
      format,
      variation_key,
      objective: ctx.objective,
      priority: priority++,
      selected_offer_ids: selectedOffers.map((offer) => offer.offer_id),
      selected_offers: selectedOffers,
      size: spec.size,
      aspect_ratio: spec.aspect_ratio,
      output_format: 'png',
      generation_prompt: buildPrompt(ctx),
      qa_requirements: [
        'texto legivel no formato',
        'precos e condicoes apenas se confirmados no material',
        'sem promessas de resultado',
        'sem antes e depois',
        'familia visual coerente com campanha',
      ],
      campaign_brief: brief,
      source_materials: safeArray(input.source_materials),
      output_folder_id: safeString(input.output_folder_id),
      planned_at: new Date().toISOString(),
    });
  }
}
if (!jobs.length) {
  return [{
    json: {
      campaign_folder: input.campaign_folder,
      status: 'failed',
      error: 'Nenhum job de variacao foi gerado. Verifique campaign_brief/offers/requested_formats.',
      output_folder_id: safeString(input.output_folder_id),
    },
  }];
}
return jobs.map((job) => ({ json: job }));
`;

const normalizeGenerationJobCode = `
function safeString(value) { return String(value ?? '').trim(); }
const raw = safeString($json.generation_job_json) ? JSON.parse($json.generation_job_json) : ($json || {});
const blockers = [];
if (!safeString(raw.asset_id)) blockers.push('missing_asset_id');
if (!safeString(raw.generation_prompt)) blockers.push('missing_generation_prompt');
if (!safeString(raw.output_folder_id)) blockers.push('missing_output_folder_id');
return [{
  json: {
    ...raw,
    generation_status: blockers.length ? 'blocked' : 'ready',
    blockers,
    file_name: \`\${safeString(raw.asset_id || 'asset')}.png\`,
  },
}];
`;

const dryRunAssetCode = `
return [{
  json: {
    ...$json,
    status: $json.generation_status === 'blocked' ? 'failed' : 'blocked',
    drive_file_id: '',
    preview_url: '',
    generated_asset: null,
    generation: {
      model: 'gpt-image-2',
      request: null,
      prompt: $json.generation_prompt,
      note: $json.generation_status === 'blocked' ? 'Geracao bloqueada por validacao.' : 'Geracao nao executada.',
    },
  },
}];
`;

const buildImageRequestCode = `
function safeString(value) { return String(value ?? '').trim(); }
const prompt = safeString($json.generation_prompt);
return [{
  json: {
    ...$json,
    openai_image_request: {
      model: 'gpt-image-2',
      prompt,
      size: safeString($json.size || '1024x1024'),
      quality: 'high',
      n: 1,
      output_format: safeString($json.output_format || 'png'),
    },
    image_request_started_at: new Date().toISOString(),
  },
}];
`;

const buildManifestCode = `
function safeString(value) { return String(value ?? '').trim(); }
const item = $input.first().json || {};
const manifest = {
  generated_at: new Date().toISOString(),
  campaign_folder: item.campaign_folder,
  asset_id: item.asset_id,
  format: item.format,
  variation_key: item.variation_key,
  status: item.status,
  drive_file_id: item.drive_file_id,
  preview_url: item.preview_url,
  prompt: item.generation_prompt,
  qa: item.qa,
  generation: item.generation || { model: 'gpt-image-2', usage: item.usage || {} },
};
return [{
  json: {
    ...item,
    manifest_file_name: \`\${safeString(item.asset_id || 'asset')}.campaign_manifest.json\`,
    manifest_json: JSON.stringify(manifest, null, 2),
  },
}];
`;

function updateWorkflow(workflow) {
  setInitialConfig(workflow);
  getNode(workflow, 'Preparar Orquestracao').parameters.jsCode = prepareOrchestrationCode;
  getNode(workflow, 'Relatorio Final da Orquestracao').parameters.jsCode = finalReportCode;
  getNode(workflow, 'Prepare Campaign Inputs').parameters.jsCode = prepareCampaignInputsCode;
  getNode(workflow, 'Normalizar Brief').parameters.jsCode = normalizeBriefCode;
  getNode(workflow, 'Build Variation Plan').parameters.jsCode = buildVariationPlanCode;
  getNode(workflow, 'Normalizar Job de Geracao').parameters.jsCode = normalizeGenerationJobCode;
  getNode(workflow, 'Dry Run Asset').parameters.jsCode = dryRunAssetCode;
  getNode(workflow, 'Build OpenAI Image Request').parameters.jsCode = buildImageRequestCode;
  getNode(workflow, 'Build Campaign Manifest').parameters.jsCode = buildManifestCode;

  getNode(workflow, 'Search Campaign Files').parameters.filter.folderId.value = '={{ $json.source_folder_id }}';
  getNode(workflow, 'Upload Generated Asset').parameters.folderId.value = '={{ $json.output_folder_id }}';
  getNode(workflow, 'Upload Campaign Manifest').parameters.folderId.value = '={{ $json.output_folder_id }}';

  const upload = getNode(workflow, 'Upload Generated Asset');
  const uploadProps = upload.parameters.options.propertiesUi.propertyValues;
  for (const prop of uploadProps) {
    if (prop.key === 'campaign_name') prop.key = 'campaign_folder';
    if (prop.value === '={{ $json.campaign_name }}') prop.value = '={{ $json.campaign_folder }}';
  }
  upload.parameters.options.propertiesUi.propertyValues = uploadProps.filter((prop) => prop.key !== 'execution_mode');

  const genSwitch = getNode(workflow, 'Switch Modo Geracao');
  for (const value of genSwitch.parameters.rules.values || []) {
    for (const condition of value.conditions.conditions || []) {
      condition.leftValue = '={{ $json.generation_status === "ready" ? "ready" : "blocked" }}';
      if (condition.rightValue === 'dry_run') condition.rightValue = 'blocked';
      if (condition.rightValue === 'live') condition.rightValue = 'ready';
    }
    if (value.outputKey === 'DryRun') value.outputKey = 'Blocked';
    if (value.outputKey === 'Live') value.outputKey = 'Ready';
  }

  workflow.meta = {
    ...(workflow.meta || {}),
    codex_variable_cleanup_at: new Date().toISOString(),
    codex_variable_cleanup_from: path.basename(INPUT_FILE),
  };
}

function validate(workflow) {
  const text = JSON.stringify(workflow);
  const hits = REMOVED_NAMES.filter((name) => text.includes(name));
  if (hits.length) throw new Error(`Removed names still present: ${hits.join(', ')}`);
  for (const required of ['campaign_folder', 'source_folder_id', 'output_folder_id']) {
    if (!text.includes(required)) throw new Error(`Required renamed variable missing: ${required}`);
  }
  const cfg = getNode(workflow, 'Configuracao Inicial').parameters;
  const configText = JSON.stringify(cfg);
  for (const value of ['06', '16a48rrGRdxcF8NMH51Vf25PYVM4hFxHQ', '1uZvk2fEzrKiDT2LHvwCbJR-B4fKdhA_Y']) {
    if (!configText.includes(value)) throw new Error(`Expected constant missing: ${value}`);
  }
}

function main() {
  const workflow = loadWorkflow();
  updateWorkflow(workflow);
  validate(workflow);
  writeWorkflow(workflow);
  console.log(`Wrote variable-clean workflow to ${OUTPUT_FILE}`);
}

main();
