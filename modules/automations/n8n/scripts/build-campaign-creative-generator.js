#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'workflows');
const PACKAGE_FILE = path.join(OUTPUT_DIR, 'campaign-creative-generator.package.json');

const IDS = {
  orchestrator: 'ccg-orchestrator-001',
  phase1: 'ccg-phase1-interpret-campaign',
  phase2: 'ccg-phase2-plan-variations',
  phase3: 'ccg-phase3-generate-asset',
  phase4: 'ccg-phase4-qa-ledger',
};

const OPENAI_CREDENTIAL = {
  openAiApi: {
    id: 'd5x9D1q8y2QXDeUD',
    name: 'OpenAi account',
  },
};

function node(id, name, type, typeVersion, position, parameters = {}, extra = {}) {
  return { parameters, id, name, type, typeVersion, position, ...extra };
}

function sticky(id, content, position, size = [420, 240]) {
  return node(id, 'Objetivo', 'n8n-nodes-base.stickyNote', 1, position, {
    content,
    height: size[1],
    width: size[0],
  });
}

function manual(id = 'manual-trigger', position = [-900, 0]) {
  return node(id, "When clicking 'Execute workflow'", 'n8n-nodes-base.manualTrigger', 1, position, {});
}

function executeTrigger(id, position = [-900, -160]) {
  return node(id, 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, position, {});
}

function setNode(id, name, position, values, keepOnlySet = false) {
  const grouped = { string: [], number: [], boolean: [] };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') grouped.boolean.push({ name: key, value });
    else if (typeof value === 'number') grouped.number.push({ name: key, value });
    else grouped.string.push({ name: key, value: String(value) });
  }
  for (const key of Object.keys(grouped)) {
    if (!grouped[key].length) delete grouped[key];
  }
  return node(id, name, 'n8n-nodes-base.set', 3.4, position, {
    keepOnlySet,
    values: grouped,
    options: {},
  });
}

function codeNode(id, name, position, jsCode) {
  return node(id, name, 'n8n-nodes-base.code', 2, position, { jsCode });
}

function switchModeNode(id, name, position, leftExpression) {
  return node(id, name, 'n8n-nodes-base.switch', 3.4, position, {
    rules: {
      values: [
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
            conditions: [{
              id: `${id}-dry-run`,
              leftValue: leftExpression,
              rightValue: 'dry_run',
              operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'DryRun',
        },
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
            conditions: [{
              id: `${id}-live`,
              leftValue: leftExpression,
              rightValue: 'live',
              operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'Live',
        },
      ],
    },
    options: {},
  });
}

function executeWorkflowNode(id, name, position, workflowIdExpression, mode, inputValue) {
  const schema = Object.keys(inputValue).map((key) => ({
    id: key,
    displayName: key,
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    removed: false,
  }));
  return node(id, name, 'n8n-nodes-base.executeWorkflow', 1.2, position, {
    source: 'database',
    workflowId: { __rl: true, value: workflowIdExpression, mode: 'id' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: inputValue,
      matchingColumns: Object.keys(inputValue),
      schema,
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    },
    mode,
    options: { waitForSubWorkflow: true },
  });
}

function googleDriveSearch(id, position, folderExpr) {
  return node(id, 'Search Campaign Files', 'n8n-nodes-base.googleDrive', 3, position, {
    resource: 'fileFolder',
    returnAll: true,
    filter: {
      folderId: { __rl: true, value: folderExpr, mode: 'id' },
      includeTrashed: false,
    },
    options: {
      fields: ['id', 'mimeType', 'name', 'size', 'webViewLink', 'webContentLink', 'thumbnailLink'],
    },
  });
}

function googleDriveDownload(id, nameOrPosition, positionOrFileExpr, maybeFileExpr) {
  const hasCustomName = typeof nameOrPosition === 'string';
  const name = hasCustomName ? nameOrPosition : 'Download Campaign File';
  const position = hasCustomName ? positionOrFileExpr : nameOrPosition;
  const fileExpr = hasCustomName ? maybeFileExpr : positionOrFileExpr;
  return node(id, name, 'n8n-nodes-base.googleDrive', 3, position, {
    operation: 'download',
    fileId: { __rl: true, value: fileExpr, mode: 'id' },
    options: {},
  });
}

function googleDriveUploadBinary(id, position) {
  return node(id, 'Upload Generated Asset', 'n8n-nodes-base.googleDrive', 3, position, {
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
  });
}

function googleDriveCreateText(id, name, position, fileNameExpr, contentExpr) {
  return node(id, name, 'n8n-nodes-base.googleDrive', 3, position, {
    resource: 'file',
    operation: 'createFromText',
    content: contentExpr,
    name: fileNameExpr,
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: '={{ $json.output_drive_folder_id }}', mode: 'id' },
    options: {},
  });
}

function openAiModel(id, name, position) {
  return node(id, name, '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, position, {
    model: { __rl: true, value: 'gpt-5.2', mode: 'list', cachedResultName: 'gpt-5.2' },
    builtInTools: {},
    options: {},
  }, { credentials: OPENAI_CREDENTIAL });
}

function parserNode(id, name, position, schema) {
  return node(id, name, '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, position, {
    schemaType: 'manual',
    inputSchema: JSON.stringify(schema, null, 2),
    autoFix: true,
  });
}

function agentNode(id, name, position, text, systemMessage) {
  return node(id, name, '@n8n/n8n-nodes-langchain.agent', 2.2, position, {
    promptType: 'define',
    text,
    hasOutputParser: true,
    options: {
      systemMessage,
      maxIterations: 4,
      passthroughBinaryImages: true,
    },
  });
}

function httpOpenAiImageNode(id, position) {
  return node(id, 'OpenAI Image Generation', 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: 'https://api.openai.com/v1/images/generations',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{$vars.OPENAI_API_KEY}}' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: '={{ JSON.stringify($json.openai_image_request) }}',
    options: { timeout: 180000 },
  });
}

function connect(connections, from, to, outputType = 'main', outputIndex = 0, inputIndex = 0) {
  if (!connections[from]) connections[from] = {};
  if (!connections[from][outputType]) connections[from][outputType] = [];
  while (connections[from][outputType].length <= outputIndex) connections[from][outputType].push([]);
  connections[from][outputType][outputIndex].push({ node: to, type: outputType, index: inputIndex });
}

function connectAi(connections, from, to, type, inputIndex = 0) {
  connect(connections, from, to, type, 0, inputIndex);
}

function workflow(id, name, nodes, connections) {
  return {
    id,
    name,
    nodes,
    connections,
    active: false,
    settings: {},
    staticData: null,
    pinData: {},
    meta: {
      templateCredsSetupCompleted: true,
      codex_generated: true,
      generated_by: 'scripts/build-campaign-creative-generator.js',
    },
  };
}

const campaignBriefSchema = {
  type: 'object',
  required: ['campaign_brief'],
  properties: {
    campaign_brief: {
      type: 'object',
      required: ['concept', 'visual_identity', 'offers', 'offer_groups', 'tone', 'mandatory_claims', 'forbidden_claims', 'needs_review'],
      properties: {
        concept: { type: 'string' },
        visual_identity: {
          type: 'object',
          required: ['palette', 'typography_style', 'decorative_elements', 'composition_rules'],
          properties: {
            palette: { type: 'array', items: { type: 'string' } },
            typography_style: { type: 'string' },
            decorative_elements: { type: 'array', items: { type: 'string' } },
            composition_rules: { type: 'array', items: { type: 'string' } },
          },
        },
        offers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['offer_id', 'title', 'price', 'conditions', 'evidence', 'confidence'],
            properties: {
              offer_id: { type: 'string' },
              title: { type: 'string' },
              price: { type: 'string' },
              conditions: { type: 'string' },
              evidence: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
        offer_groups: {
          type: 'array',
          items: {
            type: 'object',
            required: ['group_id', 'title', 'offer_ids', 'strategic_role'],
            properties: {
              group_id: { type: 'string' },
              title: { type: 'string' },
              offer_ids: { type: 'array', items: { type: 'string' } },
              strategic_role: { type: 'string' },
            },
          },
        },
        tone: { type: 'string' },
        mandatory_claims: { type: 'array', items: { type: 'string' } },
        forbidden_claims: { type: 'array', items: { type: 'string' } },
        needs_review: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const qaSchema = {
  type: 'object',
  required: ['qa'],
  properties: {
    qa: {
      type: 'object',
      required: ['readability_score', 'offer_consistency', 'compliance', 'format_fit', 'visual_consistency', 'notes'],
      properties: {
        readability_score: { type: 'number' },
        offer_consistency: { type: 'string', enum: ['pass', 'needs_review', 'fail'] },
        compliance: { type: 'string', enum: ['pass', 'needs_review', 'fail'] },
        format_fit: { type: 'string', enum: ['pass', 'needs_review', 'fail'] },
        visual_consistency: { type: 'string', enum: ['pass', 'needs_review', 'fail'] },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const prepareOrchestrationCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) {
  if (Array.isArray(value)) return value;
  const text = safeString(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; } catch {}
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}
const cfg = $('Configuracao Inicial').first().json || {};
const requested_formats = safeArray(cfg.requested_formats);
return [{
  json: {
    campaign_name: safeString(cfg.campaign_name) || 'Campanha sem nome',
    source_drive_folder_id: safeString(cfg.source_drive_folder_id),
    output_drive_folder_id: safeString(cfg.output_drive_folder_id),
    execution_mode: safeString(cfg.execution_mode || 'dry_run').toLowerCase(),
    requested_formats: requested_formats.length ? requested_formats : ['feed_3x4','stories_9x16','square_1x1','website_banner','horizontal_ad'],
    variation_mode: safeString(cfg.variation_mode || 'auto_all'),
    max_variations_per_format: Number(cfg.max_variations_per_format || 6),
    brand: safeString(cfg.brand || 'Espaco Facial'),
    compliance_note: safeString(cfg.compliance_note || 'Avaliacao individual. Resultados variam.'),
    phase_1_workflow_id: safeString(cfg.phase_1_workflow_id),
    phase_2_workflow_id: safeString(cfg.phase_2_workflow_id),
    phase_3_workflow_id: safeString(cfg.phase_3_workflow_id),
    phase_4_workflow_id: safeString(cfg.phase_4_workflow_id),
    orchestrated_at: new Date().toISOString(),
  },
}];
`;

const finalReportCode = `
function safeString(value) { return String(value ?? '').trim(); }
const items = $input.all().map((item) => item.json || {});
const approved = items.filter((item) => safeString(item.status) === 'approved').length;
const needs_review = items.filter((item) => safeString(item.status) === 'needs_review').length;
const failed = items.filter((item) => safeString(item.status) === 'failed').length;
return [{
  json: {
    campaign_name: safeString(($('Preparar Orquestracao').first().json || {}).campaign_name),
    execution_mode: safeString(($('Preparar Orquestracao').first().json || {}).execution_mode),
    finished_at: new Date().toISOString(),
    summary: { total_assets: items.length, approved, needs_review, failed },
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
function slug(value) {
  return safeString(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'campaign';
}
async function binaryBuffer(itemIndex, key) {
  if (this.helpers && this.helpers.getBinaryDataBuffer) {
    return await this.helpers.getBinaryDataBuffer(itemIndex, key);
  }
  const data = (($input.all()[itemIndex] || {}).binary || {})[key];
  if (!data || !data.data) return Buffer.alloc(0);
  return Buffer.from(data.data, 'base64');
}
function extractPdfText(filePath) {
  const childProcess = require('child_process');
  const script = [
    'import sys',
    'from pathlib import Path',
    'path = Path(sys.argv[1])',
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
    'print(text[:12000])',
  ].join('\\n');
  try {
    return childProcess.execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    return 'PDF_TEXT_EXTRACTION_FAILED: ' + safeString(error.message);
  }
}

const cfg = $('Configuracao Fase 1').first().json || {};
const items = $input.all();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  let kind = mimeType.includes('pdf') || /\\.pdf$/i.test(name) ? 'pdf' : mimeType.startsWith('image/') ? 'image' : 'other';
  if (binaryKeys.length) {
    const buf = await binaryBuffer.call(this, i, binaryKey);
    fs.writeFileSync(filePath, buf);
    sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (kind === 'pdf') text_excerpt = extractPdfText(filePath);
    if (kind === 'image' && imageIndex < 8) {
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
    text_excerpt: safeString(text_excerpt).slice(0, 12000),
    webViewLink: safeString(json.webViewLink),
    thumbnailLink: safeString(json.thumbnailLink),
  });
}

return [{
  json: {
    campaign_name: safeString(cfg.campaign_name || $json.campaign_name),
    source_drive_folder_id: safeString(cfg.source_drive_folder_id || $json.source_drive_folder_id),
    output_drive_folder_id: safeString(cfg.output_drive_folder_id || $json.output_drive_folder_id),
    execution_mode: safeString(cfg.execution_mode || $json.execution_mode || 'dry_run').toLowerCase(),
    requested_formats: safeArray(cfg.requested_formats || $json.requested_formats),
    variation_mode: safeString($json.variation_mode || cfg.variation_mode || 'auto_all'),
    max_variations_per_format: Number($json.max_variations_per_format || cfg.max_variations_per_format || 6),
    brand: safeString(cfg.brand || $json.brand || 'Espaco Facial'),
    compliance_note: safeString(cfg.compliance_note || $json.compliance_note || 'Avaliacao individual. Resultados variam.'),
    material_folder: materialFolder,
    source_materials,
    material_summary: {
      total_files: source_materials.length,
      images_attached: imageIndex,
      pdfs: source_materials.filter((item) => item.kind === 'pdf').length,
      images: source_materials.filter((item) => item.kind === 'image').length,
    },
  },
  binary,
}];
`;

const normalizeCampaignBriefCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) {
  if (Array.isArray(value)) return value;
  const text = safeString(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; } catch {}
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}
function unwrapAi(value) {
  if (value && typeof value.output === 'object') return value.output;
  if (value && typeof value.text === 'string') {
    try { return JSON.parse(value.text); } catch {}
  }
  return value || {};
}
const base = $('Prepare Campaign Inputs').first().json || {};
const ai = unwrapAi($json);
const campaign_brief = ai.campaign_brief || {};
campaign_brief.needs_review = safeArray(campaign_brief.needs_review);
for (const offer of safeArray(campaign_brief.offers)) {
  if (!safeString(offer.evidence) || Number(offer.confidence || 0) < 0.65) {
    campaign_brief.needs_review.push(\`Oferta incerta: \${safeString(offer.title || offer.offer_id)}\`);
  }
}
return [{
  json: {
    ...base,
    campaign_brief,
    interpretation_status: campaign_brief.needs_review.length ? 'needs_review' : 'ready',
    interpreted_at: new Date().toISOString(),
  },
}];
`;

const normalizeBriefInputCode = `
function safeString(value) { return String(value ?? '').trim(); }
let payload = {};
if (safeString($json.campaign_brief_json)) payload = JSON.parse($json.campaign_brief_json);
else payload = $json || {};
return [{ json: { ...payload, execution_mode: safeString(payload.execution_mode || $json.execution_mode || 'dry_run').toLowerCase() } }];
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
function selectedOffersForVariation(variation, offers, groups) {
  if (!offers.length) return [];
  if (variation === 'combo') {
    const group = groups[0];
    if (group && safeArray(group.offer_ids).length) return offers.filter((offer) => group.offer_ids.includes(offer.offer_id)).slice(0, 4);
  }
  if (variation === 'secundaria') return offers.slice(1, 3);
  return offers.slice(0, variation === 'hero' ? 2 : 1);
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
const allVariations = ['hero','oferta_principal','combo','preco','beneficio','secundaria'];
const maxPerFormat = Math.max(1, Math.min(12, Number(input.max_variations_per_format || 6)));
const variationMode = safeString(input.variation_mode || 'auto_all');
const selectedVariations = variationMode === 'auto_best' ? ['hero'] : allVariations.slice(0, maxPerFormat);
const jobs = [];
let priority = 1;
for (const format of requestedFormats) {
  const spec = formatSpec(format);
  for (const variation_key of selectedVariations) {
    const selectedOffers = selectedOffersForVariation(variation_key, offers, groups);
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
return jobs.map((job) => ({ json: job }));
`;

const normalizeGenerationJobCode = `
function safeString(value) { return String(value ?? '').trim(); }
const cfg = $('Configuracao Fase 3').first().json || {};
const raw = safeString($json.generation_job_json) ? JSON.parse($json.generation_job_json) : ($json || {});
const execution_mode = safeString(raw.execution_mode || cfg.execution_mode || 'dry_run').toLowerCase();
const model = safeString(cfg.image_model || raw.image_model || 'gpt-image-2');
const fallback_models = safeString(cfg.fallback_image_models || 'gpt-image-1.5,gpt-image-1').split(',').map((item) => item.trim()).filter(Boolean);
const blockers = [];
if (!safeString(raw.asset_id)) blockers.push('missing_asset_id');
if (!safeString(raw.generation_prompt)) blockers.push('missing_generation_prompt');
if (!safeString(raw.output_drive_folder_id)) blockers.push('missing_output_drive_folder_id');
return [{
  json: {
    ...raw,
    execution_mode,
    image_model: model,
    fallback_image_models: fallback_models,
    generation_status: blockers.length ? 'blocked' : 'ready',
    blockers,
    file_name: \`\${safeString(raw.asset_id || 'asset')}.png\`,
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
      model: safeString($json.image_model || 'gpt-image-2'),
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

const dryRunAssetCode = `
return [{
  json: {
    ...$json,
    status: $json.generation_status === 'blocked' ? 'failed' : 'dry_run_ready',
    drive_file_id: '',
    preview_url: '',
    generated_asset: null,
    generation: {
      model: $json.image_model,
      request: null,
      prompt: $json.generation_prompt,
      note: 'Dry-run: imagem nao gerada e nenhum arquivo foi enviado ao Drive.',
    },
  },
}];
`;

const normalizeOpenAiImageCode = `
function safeString(value) { return String(value ?? '').trim(); }
const response = $json || {};
const data = Array.isArray(response.data) ? response.data : [];
const first = data[0] || {};
const b64 = safeString(first.b64_json || first.image_base64 || response.b64_json);
if (!b64) throw new Error('OpenAI Image Generation nao retornou b64_json.');
const context = $('Build OpenAI Image Request').first().json || {};
return [{
  json: {
    ...context,
    b64_json: b64,
    revised_prompt: safeString(first.revised_prompt),
    usage: response.usage || {},
    image_request_completed_at: new Date().toISOString(),
  },
}];
`;

const buildImageBinaryCode = `
function safeString(value) { return String(value ?? '').trim(); }
const b64 = safeString($json.b64_json);
if (!b64) throw new Error('b64_json ausente para montar binario.');
const buffer = Buffer.from(b64, 'base64');
const binaryData = await this.helpers.prepareBinaryData(buffer, safeString($json.file_name || 'generated.png'), 'image/png');
const json = { ...$json };
delete json.b64_json;
return [{ json, binary: { data: binaryData } }];
`;

const liveAssetResultCode = `
function safeString(value) { return String(value ?? '').trim(); }
const upload = $input.first().json || {};
const context = $('Build Image Binary').first().json || {};
return [{
  json: {
    ...context,
    status: 'generated',
    drive_file_id: safeString(upload.id),
    preview_url: safeString(upload.webViewLink || upload.webContentLink || upload.webUrl),
    generated_asset: {
      drive_file_id: safeString(upload.id),
      file_name: safeString(context.file_name),
      mime_type: 'image/png',
    },
  },
}];
`;

const normalizeQaInputCode = `
function safeString(value) { return String(value ?? '').trim(); }
let payload = {};
if (safeString($json.generation_result_json)) payload = JSON.parse($json.generation_result_json);
else payload = $json || {};
return [{ json: { ...payload, qa_started_at: new Date().toISOString() } }];
`;

const prepareQaBinaryCode = `
const context = $('Normalizar Resultado Gerado').first().json || {};
const input = $input.first() || {};
return [{ json: { ...context, downloaded_for_qa: true }, binary: input.binary || {} }];
`;

const dryRunQaCode = `
return [{
  json: {
    ...$json,
    qa: {
      readability_score: 0,
      offer_consistency: 'needs_review',
      compliance: 'needs_review',
      format_fit: 'needs_review',
      visual_consistency: 'needs_review',
      notes: ['Dry-run: QA visual nao executado porque nenhuma imagem final foi gerada.'],
    },
    status: $json.status === 'failed' ? 'failed' : 'needs_review',
  },
}];
`;

const finalizeQaCode = `
function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function unwrapAi(value) {
  if (value && typeof value.output === 'object') return value.output;
  if (value && typeof value.text === 'string') {
    try { return JSON.parse(value.text); } catch {}
  }
  return value || {};
}
const base = $('Normalizar Resultado Gerado').first().json || {};
const ai = unwrapAi($json);
const qa = ai.qa || $json.qa || {};
const failures = [qa.offer_consistency, qa.compliance, qa.format_fit, qa.visual_consistency].map(safeString).filter((item) => item === 'fail');
const review = [qa.offer_consistency, qa.compliance, qa.format_fit, qa.visual_consistency].map(safeString).filter((item) => item === 'needs_review');
const readability = Number(qa.readability_score || 0);
let status = 'approved';
if (safeString(base.status) === 'failed' || failures.length) status = 'failed';
else if (review.length || readability < 70) status = 'needs_review';
return [{
  json: {
    ...base,
    status,
    qa: {
      readability_score: readability,
      offer_consistency: safeString(qa.offer_consistency || 'needs_review'),
      compliance: safeString(qa.compliance || 'needs_review'),
      format_fit: safeString(qa.format_fit || 'needs_review'),
      visual_consistency: safeString(qa.visual_consistency || 'needs_review'),
      notes: safeArray(qa.notes),
    },
    qa_completed_at: new Date().toISOString(),
  },
}];
`;

const buildLedgerCode = `
function safeString(value) { return String(value ?? '').trim(); }
const item = $input.first().json || {};
const manifest = {
  generated_at: new Date().toISOString(),
  campaign_name: item.campaign_name,
  asset_id: item.asset_id,
  format: item.format,
  variation_key: item.variation_key,
  status: item.status,
  drive_file_id: item.drive_file_id,
  preview_url: item.preview_url,
  prompt: item.generation_prompt,
  qa: item.qa,
  generation: item.generation || { model: item.image_model, usage: item.usage || {} },
};
return [{
  json: {
    ...item,
    manifest_file_name: \`\${safeString(item.asset_id || 'asset')}.campaign_manifest.json\`,
    manifest_json: JSON.stringify(manifest, null, 2),
  },
}];
`;

function buildOrchestrator() {
  const nodes = [
    sticky('sticky-orchestrator', 'Orquestra campanha criativa multiformato: interpreta materiais, planeja variacoes, gera uma imagem por job e envia para QA/ledger.', [-1120, -320]),
    manual('manual-orchestrator', [-1120, 40]),
    setNode('config-orchestrator', 'Configuracao Inicial', [-880, 40], {
      campaign_name: 'Campanha Maio',
      source_drive_folder_id: 'google-drive-folder-id',
      output_drive_folder_id: 'google-drive-folder-id',
      execution_mode: 'dry_run',
      requested_formats: '["feed_3x4","stories_9x16","square_1x1","website_banner","horizontal_ad"]',
      variation_mode: 'auto_all',
      max_variations_per_format: 6,
      brand: 'Espaco Facial',
      compliance_note: 'Avaliacao individual. Resultados variam.',
      phase_1_workflow_id: IDS.phase1,
      phase_2_workflow_id: IDS.phase2,
      phase_3_workflow_id: IDS.phase3,
      phase_4_workflow_id: IDS.phase4,
    }, true),
    codeNode('prepare-orchestration', 'Preparar Orquestracao', [-640, 40], prepareOrchestrationCode),
    executeWorkflowNode('execute-phase-1', 'Execute Fase 1', [-380, 40], '={{ $json.phase_1_workflow_id }}', 'once', {
      campaign_payload_json: '={{ JSON.stringify($json) }}',
    }),
    executeWorkflowNode('execute-phase-2', 'Execute Fase 2', [-120, 40], '={{ $("Preparar Orquestracao").first().json.phase_2_workflow_id }}', 'once', {
      campaign_brief_json: '={{ JSON.stringify($json) }}',
    }),
    executeWorkflowNode('execute-phase-3', 'Execute Fase 3', [140, 40], '={{ $("Preparar Orquestracao").first().json.phase_3_workflow_id }}', 'each', {
      generation_job_json: '={{ JSON.stringify($json) }}',
    }),
    executeWorkflowNode('execute-phase-4', 'Execute Fase 4', [400, 40], '={{ $("Preparar Orquestracao").first().json.phase_4_workflow_id }}', 'each', {
      generation_result_json: '={{ JSON.stringify($json) }}',
    }),
    codeNode('final-report', 'Relatorio Final da Orquestracao', [660, 40], finalReportCode),
  ];
  const connections = {};
  connect(connections, "When clicking 'Execute workflow'", 'Configuracao Inicial');
  connect(connections, 'Configuracao Inicial', 'Preparar Orquestracao');
  connect(connections, 'Preparar Orquestracao', 'Execute Fase 1');
  connect(connections, 'Execute Fase 1', 'Execute Fase 2');
  connect(connections, 'Execute Fase 2', 'Execute Fase 3');
  connect(connections, 'Execute Fase 3', 'Execute Fase 4');
  connect(connections, 'Execute Fase 4', 'Relatorio Final da Orquestracao');
  return workflow(IDS.orchestrator, '00 - Orquestrador - Campaign Creative Generator', nodes, connections);
}

function buildPhase1() {
  const nodes = [
    sticky('sticky-phase1', 'Fase 1: baixa materiais do Drive, extrai texto de PDFs quando possivel, anexa imagens e produz campaign_brief estruturado.', [-1120, -420]),
    manual('manual-phase1', [-1120, 40]),
    executeTrigger('execute-trigger-phase1', [-1120, -140]),
    setNode('config-phase1', 'Configuracao Fase 1', [-860, -40], {
      campaign_name: '={{ $json.campaign_name || (JSON.parse($json.campaign_payload_json || "{}")).campaign_name || "Campanha" }}',
      source_drive_folder_id: '={{ $json.source_drive_folder_id || (JSON.parse($json.campaign_payload_json || "{}")).source_drive_folder_id || "" }}',
      output_drive_folder_id: '={{ $json.output_drive_folder_id || (JSON.parse($json.campaign_payload_json || "{}")).output_drive_folder_id || "" }}',
      execution_mode: '={{ $json.execution_mode || (JSON.parse($json.campaign_payload_json || "{}")).execution_mode || "dry_run" }}',
      brand: '={{ $json.brand || (JSON.parse($json.campaign_payload_json || "{}")).brand || "Espaco Facial" }}',
      compliance_note: '={{ $json.compliance_note || (JSON.parse($json.campaign_payload_json || "{}")).compliance_note || "Avaliacao individual. Resultados variam." }}',
      requested_formats: '={{ $json.requested_formats || JSON.stringify((JSON.parse($json.campaign_payload_json || "{}")).requested_formats || []) }}',
      variation_mode: '={{ $json.variation_mode || (JSON.parse($json.campaign_payload_json || "{}")).variation_mode || "auto_all" }}',
      max_variations_per_format: '={{ $json.max_variations_per_format || (JSON.parse($json.campaign_payload_json || "{}")).max_variations_per_format || 6 }}',
    }, false),
    googleDriveSearch('search-campaign-files', [-600, -40], '={{ $json.source_drive_folder_id }}'),
    googleDriveDownload('download-campaign-file', [-340, -40], '={{ $json.id }}'),
    codeNode('prepare-campaign-inputs', 'Prepare Campaign Inputs', [-80, -40], prepareCampaignInputsCode),
    agentNode('campaign-interpreter', 'Campaign Interpreter', [180, -40],
      '=Analise os materiais da campanha e retorne SOMENTE JSON no schema exigido.\\n\\nDados recebidos:\\n{{ JSON.stringify($json) }}',
      'Voce e um Diretor de Arte Senior de Performance para Meta Ads, Social Media e Web em clinicas premium de estetica. Interprete imagens anexadas como referencia visual e textos extraidos de PDFs como fonte de ofertas/condicoes. Nunca invente preco, condicao ou promessa. Quando algo estiver ilegivel ou incerto, registre em needs_review. Use portugues do Brasil sem exageros promocionais.'),
    parserNode('campaign-brief-parser', 'Campaign Brief Parser', [180, 220], campaignBriefSchema),
    openAiModel('campaign-interpreter-model', 'OpenAI Chat Model', [-80, 220]),
    codeNode('normalize-campaign-brief', 'Normalize Campaign Brief', [440, -40], normalizeCampaignBriefCode),
  ];
  const connections = {};
  connect(connections, "When clicking 'Execute workflow'", 'Configuracao Fase 1');
  connect(connections, 'When Executed by Another Workflow', 'Configuracao Fase 1');
  connect(connections, 'Configuracao Fase 1', 'Search Campaign Files');
  connect(connections, 'Search Campaign Files', 'Download Campaign File');
  connect(connections, 'Download Campaign File', 'Prepare Campaign Inputs');
  connect(connections, 'Prepare Campaign Inputs', 'Campaign Interpreter');
  connect(connections, 'Campaign Interpreter', 'Normalize Campaign Brief');
  connectAi(connections, 'OpenAI Chat Model', 'Campaign Interpreter', 'ai_languageModel');
  connectAi(connections, 'Campaign Brief Parser', 'Campaign Interpreter', 'ai_outputParser');
  return workflow(IDS.phase1, '01 - Interpretar Campanha', nodes, connections);
}

function buildPhase2() {
  const nodes = [
    sticky('sticky-phase2', 'Fase 2: converte campaign_brief em uma matriz de jobs por formato e variacao. Cada job gera exatamente uma imagem.', [-1020, -340]),
    manual('manual-phase2', [-1020, 40]),
    executeTrigger('execute-trigger-phase2', [-1020, -140]),
    setNode('config-phase2', 'Configuracao Fase 2', [-780, -40], {
      execution_mode: 'dry_run',
      requested_formats: '["feed_3x4","stories_9x16","square_1x1","website_banner","horizontal_ad"]',
      variation_mode: 'auto_all',
      max_variations_per_format: 6,
    }, false),
    codeNode('normalize-brief-input', 'Normalizar Brief', [-520, -40], normalizeBriefInputCode),
    codeNode('build-variation-plan', 'Build Variation Plan', [-260, -40], buildVariationPlanCode),
  ];
  const connections = {};
  connect(connections, "When clicking 'Execute workflow'", 'Configuracao Fase 2');
  connect(connections, 'When Executed by Another Workflow', 'Configuracao Fase 2');
  connect(connections, 'Configuracao Fase 2', 'Normalizar Brief');
  connect(connections, 'Normalizar Brief', 'Build Variation Plan');
  return workflow(IDS.phase2, '02 - Planejar Variacoes', nodes, connections);
}

function buildPhase3() {
  const nodes = [
    sticky('sticky-phase3', 'Fase 3: recebe um job, monta request OpenAI Images, gera uma imagem em live ou somente manifesto em dry-run, e salva asset no Drive.', [-1220, -360]),
    manual('manual-phase3', [-1220, 80]),
    executeTrigger('execute-trigger-phase3', [-1220, -100]),
    setNode('config-phase3', 'Configuracao Fase 3', [-980, -20], {
      execution_mode: 'dry_run',
      image_model: 'gpt-image-2',
      fallback_image_models: 'gpt-image-1.5,gpt-image-1',
    }, false),
    codeNode('normalize-generation-job', 'Normalizar Job de Geracao', [-720, -20], normalizeGenerationJobCode),
    switchModeNode('switch-generation-mode', 'Switch Modo Geracao', [-460, -20], '={{ $json.execution_mode }}'),
    codeNode('dry-run-asset', 'Dry Run Asset', [-200, -160], dryRunAssetCode),
    codeNode('build-openai-image-request', 'Build OpenAI Image Request', [-200, 100], buildImageRequestCode),
    httpOpenAiImageNode('openai-image-generation', [60, 100]),
    codeNode('normalize-openai-image', 'Normalize OpenAI Image', [320, 100], normalizeOpenAiImageCode),
    codeNode('build-image-binary', 'Build Image Binary', [580, 100], buildImageBinaryCode),
    googleDriveUploadBinary('upload-generated-asset', [840, 100]),
    codeNode('live-asset-result', 'Live Asset Result', [1100, 100], liveAssetResultCode),
  ];
  const connections = {};
  connect(connections, "When clicking 'Execute workflow'", 'Configuracao Fase 3');
  connect(connections, 'When Executed by Another Workflow', 'Configuracao Fase 3');
  connect(connections, 'Configuracao Fase 3', 'Normalizar Job de Geracao');
  connect(connections, 'Normalizar Job de Geracao', 'Switch Modo Geracao');
  connect(connections, 'Switch Modo Geracao', 'Dry Run Asset', 'main', 0);
  connect(connections, 'Switch Modo Geracao', 'Build OpenAI Image Request', 'main', 1);
  connect(connections, 'Build OpenAI Image Request', 'OpenAI Image Generation');
  connect(connections, 'OpenAI Image Generation', 'Normalize OpenAI Image');
  connect(connections, 'Normalize OpenAI Image', 'Build Image Binary');
  connect(connections, 'Build Image Binary', 'Upload Generated Asset');
  connect(connections, 'Upload Generated Asset', 'Live Asset Result');
  return workflow(IDS.phase3, '03 - Gerar 1 Peca', nodes, connections);
}

function buildPhase4() {
  const nodes = [
    sticky('sticky-phase4', 'Fase 4: executa QA visual quando houver imagem, decide approved/needs_review/failed e grava manifest JSON no Drive.', [-1220, -360]),
    manual('manual-phase4', [-1220, 80]),
    executeTrigger('execute-trigger-phase4', [-1220, -100]),
    setNode('config-phase4', 'Configuracao Fase 4', [-980, -20], {
      execution_mode: 'dry_run',
    }, false),
    codeNode('normalize-generated-result', 'Normalizar Resultado Gerado', [-720, -20], normalizeQaInputCode),
    switchModeNode('switch-qa-mode', 'Switch Modo QA', [-460, -20], '={{ $json.status === "generated" ? "live" : "dry_run" }}'),
    codeNode('dry-run-qa', 'Dry Run QA', [-200, -160], dryRunQaCode),
    googleDriveDownload('download-generated-asset', 'Download Generated Asset', [-200, 100], '={{ $json.drive_file_id }}'),
    codeNode('prepare-qa-binary', 'Prepare QA Binary', [60, 100], prepareQaBinaryCode),
    agentNode('qa-reviewer', 'QA Reviewer', [320, 100],
      '=Avalie a imagem final gerada e retorne SOMENTE JSON no schema exigido.\\n\\nContexto do job:\\n{{ JSON.stringify($json) }}',
      'Voce e um revisor senior de direcao de arte e compliance para Meta Ads de clinica estetica. Avalie legibilidade, excesso de texto, aderencia ao formato, fidelidade a ofertas confirmadas e compliance. Reprove promessas de resultado, antes/depois, preco inventado ou informacao ilegivel.'),
    parserNode('qa-parser', 'QA Parser', [320, 360], qaSchema),
    openAiModel('qa-model', 'OpenAI Chat Model', [60, 360]),
    codeNode('finalize-qa', 'Finalize QA Status', [580, 100], finalizeQaCode),
    codeNode('build-ledger', 'Build Campaign Manifest', [840, -20], buildLedgerCode),
    googleDriveCreateText('upload-manifest', 'Upload Campaign Manifest', [1120, -20], '={{ $json.manifest_file_name }}', '={{ $json.manifest_json }}'),
    codeNode('ledger-result', 'Ledger Result', [1380, -20], 'return [{ json: { ...$(\"Build Campaign Manifest\").first().json, manifest_drive_file_id: $json.id || \"\" } }];'),
  ];
  const connections = {};
  connect(connections, "When clicking 'Execute workflow'", 'Configuracao Fase 4');
  connect(connections, 'When Executed by Another Workflow', 'Configuracao Fase 4');
  connect(connections, 'Configuracao Fase 4', 'Normalizar Resultado Gerado');
  connect(connections, 'Normalizar Resultado Gerado', 'Switch Modo QA');
  connect(connections, 'Switch Modo QA', 'Dry Run QA', 'main', 0);
  connect(connections, 'Switch Modo QA', 'Download Generated Asset', 'main', 1);
  connect(connections, 'Download Generated Asset', 'Prepare QA Binary');
  connect(connections, 'Prepare QA Binary', 'QA Reviewer');
  connect(connections, 'Dry Run QA', 'Build Campaign Manifest');
  connect(connections, 'QA Reviewer', 'Finalize QA Status');
  connect(connections, 'Finalize QA Status', 'Build Campaign Manifest');
  connect(connections, 'Build Campaign Manifest', 'Upload Campaign Manifest');
  connect(connections, 'Upload Campaign Manifest', 'Ledger Result');
  connectAi(connections, 'OpenAI Chat Model', 'QA Reviewer', 'ai_languageModel');
  connectAi(connections, 'QA Parser', 'QA Reviewer', 'ai_outputParser');
  return workflow(IDS.phase4, '04 - QA, Export e Ledger', nodes, connections);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const pack = [buildOrchestrator(), buildPhase1(), buildPhase2(), buildPhase3(), buildPhase4()];
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(PACKAGE_FILE, pack);
  const splitFiles = [
    ['campaign-creative-generator.00-orquestrador.json', pack[0]],
    ['campaign-creative-generator.01-interpretar-campanha.json', pack[1]],
    ['campaign-creative-generator.02-planejar-variacoes.json', pack[2]],
    ['campaign-creative-generator.03-gerar-1-peca.json', pack[3]],
    ['campaign-creative-generator.04-qa-export-ledger.json', pack[4]],
  ];
  for (const [fileName, data] of splitFiles) {
    writeJson(path.join(OUTPUT_DIR, fileName), data);
  }
  console.log(`Wrote ${pack.length} workflows to ${PACKAGE_FILE}`);
  for (const [fileName] of splitFiles) console.log(`- workflows/${fileName}`);
}

main();
