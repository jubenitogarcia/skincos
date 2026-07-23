#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(root, 'workflow-src', 'meta-ads-publish');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const code = (name) => fs.readFileSync(path.join(sourceRoot, name), 'utf8').replace(/\s+$/, '');
const bearer = { httpBearerAuth: { id: 'metaPublishGatewayBearer', name: 'Meta Ads Publish - Gateway Bearer' } };
const openAi = { openAiApi: { id: 'd5x9D1q8y2QXDeUD', name: 'OpenAi account' } };

function upsert(node) {
  const index = workflow.nodes.findIndex((entry) => entry.name === node.name);
  if (index >= 0) workflow.nodes[index] = { ...workflow.nodes[index], ...node };
  else workflow.nodes.push(node);
}
function codeNode(id, name, source, position) {
  return { id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code(source) } };
}
function gatewayNode(id, name, position, multipart = false) {
  const parameters = {
    method: 'POST',
    url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
    authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', sendHeaders: false, sendBody: true,
    options: { timeout: 330000 },
  };
  if (multipart) {
    parameters.contentType = 'multipart-form-data';
    parameters.bodyParameters = { parameters: [
      { parameterType: 'formData', name: 'request', value: '={{ JSON.stringify($json.gateway_request) }}' },
      { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
    ] };
  } else {
    parameters.specifyBody = 'json';
    parameters.jsonBody = '={{ $json.gateway_request }}';
  }
  return { id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.3, position, parameters, credentials: bearer, retryOnFail: true, maxTries: 4, waitBetweenTries: 10000 };
}
function ifNode(id, name, position, expression) {
  return { id, name, type: 'n8n-nodes-base.if', typeVersion: 2.3, position, parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: `${id}-condition`, leftValue: expression, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } };
}
function readNode(id, name, position, selector, field, mimeType, fileName) {
  return { id, name, type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1, position, parameters: { operation: 'read', fileSelector: selector, options: { dataPropertyName: field, mimeType, fileName } } };
}
function connect(from, to, output = 0, input = 0) {
  if (!workflow.connections[from]) workflow.connections[from] = { main: [] };
  if (!workflow.connections[from].main) workflow.connections[from].main = [];
  while (workflow.connections[from].main.length <= output) workflow.connections[from].main.push([]);
  const list = workflow.connections[from].main[output] || (workflow.connections[from].main[output] = []);
  if (!list.some((entry) => entry.node === to && entry.index === input)) list.push({ node: to, type: 'main', index: input });
}
function clearMain(name) {
  if (workflow.connections[name]) workflow.connections[name].main = [];
}

upsert(codeNode('meta-media-classify', 'Classify Media', 'classify-media.js', [-2208, 384]));
upsert(ifNode('meta-media-is-video', 'Is Video?', [-1984, 512], '={{ $json.media_type === "video" }}'));
upsert({ id: 'meta-media-prepare-staging', name: 'Prepare Video Staging Directory', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [-1760, 608], parameters: { executeOnce: false, command: '=install -d -m 0750 -- "{{ $json.media_staging.base_dir }}"' } });
upsert(codeNode('meta-media-attach-staging', 'Attach Video Staging Context', 'attach-video-staging-context.js', [-1536, 608]));
upsert({ id: 'meta-media-write-video', name: 'Write Video Source', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1, position: [-1312, 608], parameters: { operation: 'write', fileName: '={{ $json.media_staging.input_file }}', dataPropertyName: 'data', options: {} } });
upsert({ id: 'meta-media-process-video', name: 'Process Video Asset', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [-1088, 608], parameters: { executeOnce: false, command: '=node /var/lib/skincos-runtime/orb/scripts/meta-ads/process-video-asset.js --payload-b64 {{ $json.processor_payload_b64 }}' } });
upsert(codeNode('meta-media-parse-video', 'Parse Processed Video', 'parse-processed-video.js', [-864, 608]));
upsert(ifNode('meta-media-has-audio', 'Video Has Audio?', [-1088, 608], '={{ $json.media_processing.has_audio === true }}'));
upsert(readNode('meta-media-read-audio', 'Read Video Audio', [-864, 736], '={{ $json.media_processing.audio_file }}', 'data', 'audio/wav', '={{ $json.id + ".wav" }}'));
upsert({ id: 'meta-media-transcribe', name: 'Transcribe Video Audio', type: '@n8n/n8n-nodes-langchain.openAi', typeVersion: 2.1, position: [-640, 736], parameters: { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', options: { language: 'pt', temperature: 0 } }, credentials: openAi, continueOnFail: true });
upsert(codeNode('meta-media-attach-transcript', 'Attach Video Transcript', 'attach-video-transcript.js', [-416, 608]));
upsert(readNode('meta-media-read-main', 'Read Normalized Video', [-192, 384], '={{ $json.media_processing.normalized_file }}', 'data', 'video/mp4', '={{ $json.id + ".mp4" }}'));
upsert(codeNode('meta-media-attach-main', 'Attach Video Main', 'attach-video-main.js', [32, 384]));
upsert(readNode('meta-media-read-analysis', 'Read Video Contact Sheet', [256, 384], '={{ $json.media_processing.contact_sheet_file }}', 'analysis', 'image/jpeg', '={{ $json.id + "-contact-sheet.jpg" }}'));
upsert(codeNode('meta-media-attach-analysis', 'Attach Video Analysis', 'attach-video-analysis.js', [480, 384]));
upsert(readNode('meta-media-read-thumbnail', 'Read Video Thumbnail', [704, 384], '={{ $json.media_processing.thumbnail_file }}', 'thumbnail', 'image/jpeg', '={{ $json.id + "-thumbnail.jpg" }}'));
upsert(codeNode('meta-media-attach-thumbnail', 'Attach Video Thumbnail', 'attach-video-thumbnail.js', [928, 384]));
upsert({ id: 'meta-media-inventory', name: 'Prepare Media Inventory', type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [1152, 512], parameters: { mode: 'append' } });

upsert(codeNode('meta-video-start-prepare', 'Prepare Video Upload Starts', 'prepare-video-upload-starts.js', [-192, 256]));
upsert(gatewayNode('meta-video-start', 'Start Video Upload', [32, 256]));
upsert(codeNode('meta-video-start-normalize', 'Normalize Video Upload Start', 'normalize-video-upload-start.js', [256, 256]));
upsert(codeNode('meta-video-chunk-prepare', 'Prepare Video Chunk', 'prepare-video-chunk.js', [480, 256]));
upsert({ id: 'meta-video-slice', name: 'Slice Video Chunk', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [704, 256], parameters: { executeOnce: false, command: '=node /var/lib/skincos-runtime/orb/scripts/meta-ads/slice-video-chunk.js --payload-b64 {{ $json.chunk_payload_b64 }}' } });
upsert(codeNode('meta-video-slice-parse', 'Parse Video Slice', 'parse-video-slice.js', [928, 256]));
upsert(readNode('meta-video-read-chunk', 'Read Video Chunk', [1152, 256], '={{ $json.chunk_file }}', 'data', 'application/octet-stream', '={{ "video-" + $json.state.start_offset + ".part" }}'));
upsert(codeNode('meta-video-transfer-prepare', 'Prepare Video Chunk Transfer', 'prepare-video-chunk-transfer.js', [1376, 256]));
upsert(gatewayNode('meta-video-transfer', 'Transfer Video Chunk', [1600, 256], true));
upsert(codeNode('meta-video-transfer-normalize', 'Normalize Video Chunk Transfer', 'normalize-video-chunk-transfer.js', [1824, 256]));
upsert(ifNode('meta-video-bytes-complete', 'Video Bytes Complete?', [2048, 256], '={{ $json.upload_bytes_complete === true }}'));
upsert(codeNode('meta-video-finish-prepare', 'Prepare Video Finish', 'prepare-video-finish.js', [2272, 160]));
upsert(gatewayNode('meta-video-finish', 'Finish Video Upload', [2496, 160]));
upsert(codeNode('meta-video-finish-normalize', 'Normalize Video Finish', 'normalize-video-finish.js', [2720, 160]));
upsert(codeNode('meta-video-status-prepare', 'Prepare Video Status', 'prepare-video-status.js', [2944, 160]));
upsert(gatewayNode('meta-video-status', 'Get Video Status', [3168, 160]));
upsert(codeNode('meta-video-status-normalize', 'Normalize Video Status', 'normalize-video-status.js', [3392, 160]));
upsert(ifNode('meta-video-ready', 'Video Ready?', [3616, 160], '={{ $json.ready === true }}'));
upsert({ id: 'meta-video-status-wait', name: 'Wait Video Processing', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [3840, 288], webhookId: 'meta-video-status-wait', parameters: { amount: 5, unit: 'seconds' } });
upsert({ id: 'meta-upload-results-merge', name: 'Merge Media Upload Results', type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [480, 480], parameters: { mode: 'append' } });

const search = workflow.nodes.find((node) => node.name === 'Search File');
search.parameters.queryString = "=(mimeType contains 'image/' or mimeType = 'video/mp4' or mimeType = 'video/quicktime') and not properties has {key = 'published' and value = 'true'} and trashed = false";

const agent = workflow.nodes.find((node) => node.name === 'Visual Grouping Agent');
agent.parameters.text = '=Analise todas as {{ $json.input_count }} representacoes visuais como um unico lote. Cada imagem estatica aparece diretamente; cada video aparece apenas como contact sheet 2x2, metadados e transcricao. Use media_ref, nunca nome ou id do arquivo.\n\nContrato: {{ $json.grouping_contract }}\nPapeis obrigatorios: {{ JSON.stringify($json.required_roles) }}\nManifesto:\n{{ JSON.stringify($json.media.map(({ media_ref, media_type, mime_type, width, height, duration_seconds, has_audio, transcript }) => ({ media_ref, media_type, mime_type, width, height, duration_seconds, has_audio, transcript }))) }}\n\nCompare procedimento, oferta, preco, textos e composicao. Atribua cada midia exatamente uma vez e retorne somente o JSON exigido.';
agent.parameters.options.systemMessage = 'Voce e um agente multimodal de agrupamento de criativos Meta Ads. Ignore completamente nomes e ids de arquivos. Imagens sao mostradas diretamente; videos sao representados por contact sheet, dimensoes, duracao e transcricao, nunca pelo video bruto. Compare todo o lote antes de agrupar por procedimento, oferta, preco, condicao, pessoas, paleta e composicao. Em contrato legado, cada grupo tem feed, banner e stories. Em contrato misto v2, cada grupo tem exatamente feed_image, banner_image, vertical_image e vertical_video; o video deve ser 9x16 e pertencer inequivocamente ao mesmo conceito/oferta. Confiança abaixo de 0.75 deve ser declarada e bloquear o lote, nunca mascarada. Grupos deterministas VISUAL_GROUP_01... pela primeira midia. Nao use nomes como evidencia. Responda somente no schema.';

const model = workflow.nodes.find((node) => node.name === 'OpenAI Vision Model (Grouping)');
model.parameters.options.textFormat.textOptions.schema = JSON.stringify({
  type: 'object', additionalProperties: false, required: ['groups', 'assignments', 'warnings'], properties: {
    groups: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['group_key', 'visual_concept', 'confidence', 'evidence'], properties: {
      group_key: { type: 'string', pattern: '^VISUAL_GROUP_[0-9]{2,}$' }, visual_concept: { type: 'string', minLength: 1, maxLength: 160 }, confidence: { type: 'number', minimum: 0.75, maximum: 1 }, evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
    } } },
    assignments: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['media_ref', 'media_type', 'group_key', 'role', 'ratio', 'confidence', 'evidence'], properties: {
      media_ref: { type: 'string', pattern: '^(MEDIA|IMG)_[0-9]{3,}$' }, media_type: { type: 'string', enum: ['image', 'video'] }, group_key: { type: 'string', pattern: '^VISUAL_GROUP_[0-9]{2,}$' }, role: { type: 'string', enum: ['feed', 'banner', 'stories', 'feed_image', 'banner_image', 'vertical_image', 'vertical_video'] }, ratio: { type: 'string', enum: ['1x1', '2x1', '3x4', '4x5', '9x16'] }, confidence: { type: 'number', minimum: 0.75, maximum: 1 }, evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
    } } }, warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
  },
}, null, 2);

clearMain('Download File');
clearMain('Classify Media'); clearMain('Is Video?'); clearMain('Prepare Video Staging Directory'); clearMain('Attach Video Staging Context'); clearMain('Write Video Source'); clearMain('Process Video Asset'); clearMain('Parse Processed Video'); clearMain('Video Has Audio?'); clearMain('Read Video Audio'); clearMain('Transcribe Video Audio'); clearMain('Attach Video Transcript'); clearMain('Read Normalized Video'); clearMain('Attach Video Main'); clearMain('Read Video Contact Sheet'); clearMain('Attach Video Analysis'); clearMain('Read Video Thumbnail'); clearMain('Attach Video Thumbnail'); clearMain('Prepare Media Inventory');
connect('Download File', 'Classify Media'); connect('Classify Media', 'Is Video?'); connect('Is Video?', 'Prepare Video Staging Directory', 0); connect('Is Video?', 'Prepare Media Inventory', 1, 0); connect('Prepare Video Staging Directory', 'Attach Video Staging Context'); connect('Attach Video Staging Context', 'Write Video Source'); connect('Write Video Source', 'Process Video Asset'); connect('Process Video Asset', 'Parse Processed Video'); connect('Parse Processed Video', 'Video Has Audio?'); connect('Video Has Audio?', 'Read Video Audio', 0); connect('Video Has Audio?', 'Attach Video Transcript', 1); connect('Read Video Audio', 'Transcribe Video Audio'); connect('Transcribe Video Audio', 'Attach Video Transcript'); connect('Attach Video Transcript', 'Read Normalized Video'); connect('Read Normalized Video', 'Attach Video Main'); connect('Attach Video Main', 'Read Video Contact Sheet'); connect('Read Video Contact Sheet', 'Attach Video Analysis'); connect('Attach Video Analysis', 'Read Video Thumbnail'); connect('Attach Video Thumbnail', 'Prepare Media Inventory', 0, 1); connect('Prepare Media Inventory', 'Prepare Visual Grouping Batch');

clearMain('Resume Drive Only?');
connect('Resume Drive Only?', 'Build Drive Finalization', 0); connect('Resume Drive Only?', 'Prepare Gateway Uploads', 1); connect('Resume Drive Only?', 'Prepare Video Upload Starts', 1); connect('Resume Drive Only?', 'Livia', 1);
clearMain('Normalize Gateway Upload'); clearMain('Prepare Video Upload Starts'); clearMain('Start Video Upload'); clearMain('Normalize Video Upload Start'); clearMain('Prepare Video Chunk'); clearMain('Slice Video Chunk'); clearMain('Parse Video Slice'); clearMain('Read Video Chunk'); clearMain('Prepare Video Chunk Transfer'); clearMain('Transfer Video Chunk'); clearMain('Normalize Video Chunk Transfer'); clearMain('Video Bytes Complete?'); clearMain('Prepare Video Finish'); clearMain('Finish Video Upload'); clearMain('Normalize Video Finish'); clearMain('Prepare Video Status'); clearMain('Get Video Status'); clearMain('Normalize Video Status'); clearMain('Video Ready?'); clearMain('Wait Video Processing'); clearMain('Merge Media Upload Results');
connect('Normalize Gateway Upload', 'Merge Media Upload Results', 0, 0); connect('Prepare Video Upload Starts', 'Start Video Upload'); connect('Start Video Upload', 'Normalize Video Upload Start'); connect('Normalize Video Upload Start', 'Prepare Video Chunk'); connect('Prepare Video Chunk', 'Slice Video Chunk'); connect('Slice Video Chunk', 'Parse Video Slice'); connect('Parse Video Slice', 'Read Video Chunk'); connect('Read Video Chunk', 'Prepare Video Chunk Transfer'); connect('Prepare Video Chunk Transfer', 'Transfer Video Chunk'); connect('Transfer Video Chunk', 'Normalize Video Chunk Transfer'); connect('Normalize Video Chunk Transfer', 'Video Bytes Complete?'); connect('Video Bytes Complete?', 'Prepare Video Finish', 0); connect('Video Bytes Complete?', 'Prepare Video Chunk', 1); connect('Prepare Video Finish', 'Finish Video Upload'); connect('Finish Video Upload', 'Normalize Video Finish'); connect('Normalize Video Finish', 'Prepare Video Status'); connect('Prepare Video Status', 'Get Video Status'); connect('Get Video Status', 'Normalize Video Status'); connect('Normalize Video Status', 'Video Ready?'); connect('Video Ready?', 'Merge Media Upload Results', 0, 1); connect('Video Ready?', 'Wait Video Processing', 1); connect('Wait Video Processing', 'Prepare Video Status'); connect('Merge Media Upload Results', 'Merge (2)', 0, 1);

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ nodes: workflow.nodes.length, workflowPath }, null, 2));
