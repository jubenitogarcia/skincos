#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.unified.before-optimize.20260601.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'workflows', 'campaign-creative-generator.unified.optimized.json');

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

function setConfigNode(node, values, keepOnlySet = true) {
  const grouped = { string: [], number: [], boolean: [] };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'boolean') grouped.boolean.push({ name, value });
    else if (typeof value === 'number') grouped.number.push({ name, value });
    else grouped.string.push({ name, value: String(value) });
  }
  for (const key of Object.keys(grouped)) {
    if (!grouped[key].length) delete grouped[key];
  }
  node.parameters = { keepOnlySet, values: grouped, options: {} };
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
  return !text || text === 'google-drive-folder-id' || text.includes('substituir') || text.includes('placeholder');
}
const cfg = $('Configuracao Inicial').first().json || {};
const requested_formats = safeArray(cfg.requested_formats);
const source_drive_folder_id = safeString(cfg.source_drive_folder_id);
const output_drive_folder_id = safeString(cfg.output_drive_folder_id);
const errors = [];
if (isPlaceholder(source_drive_folder_id)) errors.push('source_drive_folder_id ausente ou placeholder');
if (isPlaceholder(output_drive_folder_id)) errors.push('output_drive_folder_id ausente ou placeholder');
if (errors.length) {
  throw new Error('Campaign Creative Generator preflight bloqueado: ' + errors.join('; '));
}
return [{
  json: {
    campaign_name: safeString(cfg.campaign_name) || 'Campanha sem nome',
    source_drive_folder_id,
    output_drive_folder_id,
    execution_mode: safeString(cfg.execution_mode || 'dry_run').toLowerCase() === 'live' ? 'live' : 'dry_run',
    requested_formats: requested_formats.length ? requested_formats : ['feed_3x4','stories_9x16','square_1x1','website_banner','horizontal_ad'],
    variation_mode: safeString(cfg.variation_mode || 'auto_all'),
    max_variations_per_format: positiveInt(cfg.max_variations_per_format, 6, 1, 12),
    max_jobs_total: positiveInt(cfg.max_jobs_total, 30, 1, 120),
    max_source_files: positiveInt(cfg.max_source_files, 40, 1, 200),
    max_image_references: positiveInt(cfg.max_image_references, 8, 1, 20),
    max_pdf_chars: positiveInt(cfg.max_pdf_chars, 12000, 1000, 50000),
    image_model: safeString(cfg.image_model || 'gpt-image-2'),
    fallback_image_models: safeString(cfg.fallback_image_models || 'gpt-image-1.5,gpt-image-1'),
    brand: safeString(cfg.brand || 'Espaco Facial'),
    compliance_note: safeString(cfg.compliance_note || 'Avaliacao individual. Resultados variam.'),
    unified_workflow_id: 'ccg-orchestrator-001',
    orchestrated_at: new Date().toISOString(),
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

const cfg = $('Configuracao Fase 1').first().json || {};
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
    feed_3x4: { size: '1024x1536', aspect_ratio: '3:4', objective: 'feed equilibrado e comercial' },
    stories_9x16: { size: '1024x1792', aspect_ratio: '9:16', objective: 'leitura imediata para stories/reels' },
    square_1x1: { size: '1024x1024', aspect_ratio: '1:1', objective: 'post quadrado sintetico' },
    website_banner: { size: '1536x1024', aspect_ratio: '3:2', objective: 'banner web horizontal claro' },
    horizontal_ad: { size: '1792x1024', aspect_ratio: '16:9', objective: 'anuncio horizontal de leitura rapida' },
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
function allowedVariations(offers, groups, mode, maxPerFormat) {
  if (mode === 'auto_best') return ['hero'];
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
    \`Marca: \${ctx.brand}.\`,
    \`Campanha: \${ctx.campaign_name}.\`,
    \`Formato: \${ctx.format} (\${ctx.spec.aspect_ratio}, tamanho recomendado \${ctx.spec.size}).\`,
    \`Variacao: \${ctx.variation_key}. Objetivo: \${ctx.objective}.\`,
    \`Conceito criativo: \${ctx.brief.concept || 'usar materiais da campanha'}.\`,
    \`Paleta: \${safeArray(ctx.brief.visual_identity && ctx.brief.visual_identity.palette).join(', ')}.\`,
    \`Tipografia/estilo: \${safeString(ctx.brief.visual_identity && ctx.brief.visual_identity.typography_style)}.\`,
    \`Elementos decorativos: \${safeArray(ctx.brief.visual_identity && ctx.brief.visual_identity.decorative_elements).join(', ')}.\`,
    \`Ofertas autorizadas: \${offersText || 'nenhuma oferta/preco confirmado; criar variacao institucional sem inventar preco'}.\`,
    \`Tom: \${ctx.brief.tone || 'premium, claro, comercial e responsavel'}.\`,
    \`Compliance: nao prometer resultado garantido, nao usar antes/depois, nao explorar insegurancas. \${ctx.compliance_note}\`,
    'Selecione apenas informacoes legiveis para o formato. Nao tente colocar toda a campanha em uma arte.',
    'A imagem deve parecer parte de uma familia visual maior de variacoes.',
  ].filter(Boolean).join('\\n');
}

const input = $input.first().json || {};
const brief = input.campaign_brief || {};
const offers = safeArray(brief.offers);
const groups = safeArray(brief.offer_groups);
const requestedFormats = safeArray(input.requested_formats).length ? safeArray(input.requested_formats) : ['feed_3x4','stories_9x16','square_1x1','website_banner','horizontal_ad'];
const maxPerFormat = Math.max(1, Math.min(12, Number(input.max_variations_per_format || 6)));
const maxJobsTotal = Math.max(1, Math.min(120, Number(input.max_jobs_total || 30)));
const variationMode = safeString(input.variation_mode || 'auto_all');
const selectedVariations = allowedVariations(offers, groups, variationMode, maxPerFormat);
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
    const asset_id = \`\${slug(input.campaign_name)}__\${format}__\${variation_key}__v1\`;
    const ctx = {
      brand: input.brand || 'Espaco Facial',
      campaign_name: input.campaign_name,
      format,
      variation_key,
      objective: objectiveByVariation[variation_key] || spec.objective,
      spec,
      brief,
      offers: selectedOffers,
      compliance_note: input.compliance_note,
    };
    jobs.push({
      asset_id,
      campaign_name: input.campaign_name,
      brand: input.brand,
      format,
      variation_key,
      objective: ctx.objective,
      priority: priority++,
      selected_offer_ids: selectedOffers.map((offer) => offer.offer_id),
      selected_offers: selectedOffers,
      size: spec.size,
      aspect_ratio: spec.aspect_ratio,
      output_format: 'png',
      image_model: safeString(input.image_model || 'gpt-image-2'),
      fallback_image_models: safeString(input.fallback_image_models || 'gpt-image-1.5,gpt-image-1'),
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
      output_drive_folder_id: safeString(input.output_drive_folder_id),
      execution_mode: safeString(input.execution_mode || 'dry_run').toLowerCase(),
      compliance_note: input.compliance_note,
      planned_at: new Date().toISOString(),
    });
  }
}
if (!jobs.length) {
  return [{
    json: {
      campaign_name: input.campaign_name,
      status: 'failed',
      error: 'Nenhum job de variacao foi gerado. Verifique campaign_brief/offers/requested_formats.',
      execution_mode: safeString(input.execution_mode || 'dry_run').toLowerCase(),
      output_drive_folder_id: safeString(input.output_drive_folder_id),
    },
  }];
}
return jobs.map((job) => ({ json: job }));
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
    campaign_name: safeString(($('Preparar Orquestracao').first().json || {}).campaign_name),
    execution_mode: safeString(($('Preparar Orquestracao').first().json || {}).execution_mode),
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

function optimize(workflow) {
  workflow.name = 'Campaign Creative Generator';

  setConfigNode(getNode(workflow, 'Configuracao Inicial'), {
    campaign_name: 'Campanha Maio',
    source_drive_folder_id: 'google-drive-folder-id',
    output_drive_folder_id: 'google-drive-folder-id',
    execution_mode: 'dry_run',
    requested_formats: '["feed_3x4","stories_9x16","square_1x1","website_banner","horizontal_ad"]',
    variation_mode: 'auto_all',
    max_variations_per_format: 6,
    max_jobs_total: 30,
    max_source_files: 40,
    max_image_references: 8,
    max_pdf_chars: 12000,
    image_model: 'gpt-image-2',
    fallback_image_models: 'gpt-image-1.5,gpt-image-1',
    brand: 'Espaco Facial',
    compliance_note: 'Avaliacao individual. Resultados variam.',
  }, true);

  for (const phaseConfigName of ['Configuracao Fase 1', 'Configuracao Fase 2', 'Configuracao Fase 3', 'Configuracao Fase 4']) {
    const phaseConfig = getNode(workflow, phaseConfigName);
    phaseConfig.parameters = { keepOnlySet: false, values: {}, options: {} };
  }

  getNode(workflow, 'Preparar Orquestracao').parameters.jsCode = prepareOrchestrationCode;
  getNode(workflow, 'Prepare Campaign Inputs').parameters.jsCode = prepareCampaignInputsCode;
  getNode(workflow, 'Build Variation Plan').parameters.jsCode = buildVariationPlanCode;
  getNode(workflow, 'Relatorio Final da Orquestracao').parameters.jsCode = finalReportCode;

  const search = getNode(workflow, 'Search Campaign Files');
  search.parameters.returnAll = false;
  search.parameters.limit = '={{ Number($json.max_source_files || 40) }}';
  search.parameters.filter = search.parameters.filter || {};
  search.parameters.filter.includeTrashed = false;

  const genSwitch = getNode(workflow, 'Switch Modo Geracao');
  for (const value of genSwitch.parameters.rules.values || []) {
    for (const condition of value.conditions.conditions || []) {
      condition.leftValue = '={{ $json.generation_status === "ready" ? $json.execution_mode : "dry_run" }}';
    }
  }

  const upload = getNode(workflow, 'Upload Generated Asset');
  upload.parameters = {
    resource: 'file',
    operation: 'upload',
    inputDataFieldName: 'data',
    name: '={{ $json.file_name }}',
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: '={{ $json.output_drive_folder_id }}', mode: 'id' },
    options: {
      simplifyOutput: true,
      propertiesUi: {
        propertyValues: [
          { key: 'campaign_name', value: '={{ $json.campaign_name }}' },
          { key: 'asset_id', value: '={{ $json.asset_id }}' },
          { key: 'format', value: '={{ $json.format }}' },
          { key: 'variation_key', value: '={{ $json.variation_key }}' },
          { key: 'execution_mode', value: '={{ $json.execution_mode }}' },
        ],
      },
    },
  };

  workflow.meta = {
    ...(workflow.meta || {}),
    codex_optimized_at: new Date().toISOString(),
    codex_optimized_from: path.basename(INPUT_FILE),
  };
  return workflow;
}

function validate(workflow) {
  const names = new Set((workflow.nodes || []).map((node) => node.name));
  const findings = [];
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) findings.push(`Missing source ${source}`);
    for (const buckets of Object.values(outputs || {})) {
      for (const bucket of buckets || []) {
        for (const edge of bucket || []) {
          if (!names.has(edge.node)) findings.push(`Missing target ${edge.node} from ${source}`);
        }
      }
    }
  }
  const upload = getNode(workflow, 'Upload Generated Asset');
  for (const key of ['resource', 'operation', 'inputDataFieldName']) {
    if (!upload.parameters[key]) findings.push(`Upload Generated Asset missing ${key}`);
  }
  if (!getNode(workflow, 'Configuracao Inicial').parameters.values) findings.push('Configuracao Inicial missing values');
  if (findings.length) throw new Error(findings.join('\\n'));
}

function main() {
  const workflow = optimize(loadWorkflow());
  validate(workflow);
  writeWorkflow(workflow);
  console.log(`Wrote optimized workflow to ${OUTPUT_FILE}`);
}

main();
