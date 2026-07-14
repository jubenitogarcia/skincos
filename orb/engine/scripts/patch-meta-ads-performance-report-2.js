const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, 'workflows', 'meta-ads.performance-report-2.live.current.json');
const outputPath = path.join(rootDir, 'workflows', 'meta-ads.performance-report-2.live.implemented.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadText(fileName) {
  return fs.readFileSync(path.join(__dirname, fileName), 'utf8');
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) {
    throw new Error(`Node "${name}" nao encontrado no workflow canônico.`);
  }
  return node;
}

function upsertNode(workflow, nodeDefinition) {
  const index = workflow.nodes.findIndex((item) => item.name === nodeDefinition.name);
  if (index >= 0) {
    workflow.nodes[index] = {
      ...workflow.nodes[index],
      ...nodeDefinition,
      parameters: nodeDefinition.parameters ?? workflow.nodes[index].parameters,
    };
    return workflow.nodes[index];
  }

  workflow.nodes.push(nodeDefinition);
  return nodeDefinition;
}

function syncCodeNode(workflow, nodeName, helperFileName) {
  const node = getNode(workflow, nodeName);
  if (node.type !== 'n8n-nodes-base.code') {
    throw new Error(`Node "${nodeName}" deveria ser Code, mas esta como ${node.type}.`);
  }
  node.parameters = node.parameters || {};
  node.parameters.jsCode = loadText(helperFileName);
}

function ensureGetCreativeHttpNode(workflow) {
  const node = getNode(workflow, 'Get Creative');
  node.type = 'n8n-nodes-base.httpRequest';
  node.typeVersion = 4.2;
  node.parameters = {
    url: "={{ 'https://graph.facebook.com/' + (($('Meta API Params').first().json.api_version || 'v24.0').replace(/^\\/+|\\/+$/g, '')) + '/' + $json.creative_id }}",
    sendQuery: true,
    queryParameters: {
      parameters: [
        {
          name: 'fields',
          value: 'id,name,status,account_id',
        },
        {
          name: 'access_token',
          value: "={{ $('Meta API Params').first().json.meta_ads_access_token }}",
        },
      ],
    },
    options: {},
  };
}

function ensureOutgoingSlot(connections, nodeName, outputIndex) {
  if (!connections[nodeName]) connections[nodeName] = { main: [] };
  if (!Array.isArray(connections[nodeName].main)) connections[nodeName].main = [];
  while (connections[nodeName].main.length <= outputIndex) {
    connections[nodeName].main.push([]);
  }
  if (!Array.isArray(connections[nodeName].main[outputIndex])) {
    connections[nodeName].main[outputIndex] = [];
  }
  return connections[nodeName].main[outputIndex];
}

function setConnection(connections, sourceNode, outputIndex, targetNode, inputIndex = 0) {
  const slot = ensureOutgoingSlot(connections, sourceNode, outputIndex);
  const filtered = slot.filter((edge) => edge.node !== targetNode);
  filtered.push({ node: targetNode, type: 'main', index: inputIndex });
  connections[sourceNode].main[outputIndex] = filtered;
}

function removeConnection(connections, sourceNode, targetNode) {
  if (!connections[sourceNode] || !Array.isArray(connections[sourceNode].main)) return;
  connections[sourceNode].main = connections[sourceNode].main.map((slot) =>
    Array.isArray(slot) ? slot.filter((edge) => edge.node !== targetNode) : slot,
  );
}

function ensureHttpNodeShape(workflow) {
  const gestor = getNode(workflow, 'Gestor Tráfego');
  if (gestor.type !== 'n8n-nodes-base.httpRequest') {
    throw new Error('Node "Gestor Tráfego" saiu da forma validada (HTTP Request).');
  }

  gestor.parameters = gestor.parameters || {};
  gestor.parameters.jsonBody = `={{ (() => {
  const baseText = String($json.delivery_text_base || $json.group_message || $json.message_text || '').trim();
  const output = $json.output || {};
  const group = output.group_analysis || {};
  const reviews = Array.isArray(output.entity_reviews) ? output.entity_reviews : [];

  const focusLines = Array.isArray(group.priority_subjective_focus)
    ? group.priority_subjective_focus.slice(0, 3).map((item, index) => \`\${index + 1}. \${String(item || '').trim()}\`).filter(Boolean)
    : [];

  const entityLines = reviews.slice(0, 3).map((review) => {
    const entityId = String(review?.entity_id || '').trim();
    const action = String(review?.math_action || '').trim();
    const signal = String(review?.subjective_summary || review?.recommended_creative_direction || '').trim();
    const base = [entityId, action].filter(Boolean).join(' · ');
    return [base, signal].filter(Boolean).join(' — ');
  }).filter(Boolean);

  const aiSection = [];
  if (String(group.group_summary || '').trim()) {
    aiSection.push('*Leitura Criativa (IA)*');
    aiSection.push(String(group.group_summary || '').trim());
  }
  if (focusLines.length) {
    aiSection.push('Focos criativos:');
    aiSection.push(focusLines.join('\\n'));
  }
  if (entityLines.length) {
    aiSection.push('Entidades com revisão subjetiva:');
    aiSection.push(entityLines.join('\\n'));
  }

  const text = [baseText, aiSection.length ? aiSection.join('\\n') : '']
    .filter(Boolean)
    .join('\\n\\n')
    .trim();

  return {
    number: String(($('Meta API Params').first().json.remote_jid || '')).replace(/\\D+/g, ''),
    text: text || '*Meta Ads – Performance Report (2)*'
  };
})() }}`;

  const mergeCreativeContext = getNode(workflow, 'Merge Creative Context');
  if (mergeCreativeContext.type !== 'n8n-nodes-base.merge') {
    throw new Error('Node "Merge Creative Context" saiu da forma validada (Merge).');
  }

  mergeCreativeContext.parameters = mergeCreativeContext.parameters || {};
  mergeCreativeContext.parameters.mode = 'combine';
  mergeCreativeContext.parameters.combineBy = 'combineByPosition';
}

function ensureAiNodeShape(workflow) {
  const livia = getNode(workflow, 'Livia');
  if (livia.type !== '@n8n/n8n-nodes-langchain.agent') {
    throw new Error('Node "Livia" saiu da forma validada (AI Agent).');
  }

  livia.parameters = livia.parameters || {};
  livia.parameters.text = `=Analise subjetivamente apenas o que depende de julgamento criativo, visual e persuasivo.

IMPORTANTE:
- Não refaça análise matemática.
- Não reinterprete métricas além do contexto mínimo necessário.
- Use a decisão matemática apenas como contexto.
- Foque em leitura criativa, visual, persuasiva e de comunicação.
- Se a imagem for fallback thumbnail, reduza a confiança visual.
- Se não houver imagem real utilizável, deixe isso claro.
- Seja específico e prático.

Contexto subjetivo do grupo:
{{ JSON.stringify($json.subjective_ai_payload || {}, null, 2) }}

Tarefa:
1. Avaliar qualidade subjetiva do criativo.
2. Avaliar força visual da CTA.
3. Avaliar clareza da oferta e da promessa.
4. Avaliar adequação da imagem, pessoas, rostos, expressões e estética.
5. Avaliar coerência entre imagem, título, texto e oferta.
6. Dizer se a decisão matemática parece reforçada, neutra ou enfraquecida pela análise subjetiva.
7. Sugerir ajustes criativos concretos.
8. Retornar apenas o JSON estruturado solicitado.`;
}

function ensureAiRoutingNodes(workflow) {
  upsertNode(workflow, {
    id: '7e3e4d10-1cd2-4b85-9848-f19e2f997f5a',
    name: 'Needs Subjective AI Review',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1864, 944],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: '936f355f-5060-4ce3-bc30-11c9bf19c7aa',
            leftValue: '={{ $json.requires_subjective_ai_review }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  });

  upsertNode(workflow, {
    id: '98d8d4a3-a29d-45d7-b4d5-0d3541b0d507',
    name: 'Merge AI Review Context',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position: [2240, 944],
    parameters: {
      mode: 'combine',
      combineBy: 'combineByPosition',
      options: {},
    },
  });
}

function ensureAiRoutingConnections(workflow) {
  const connections = workflow.connections || {};
  workflow.connections = connections;

  removeConnection(connections, 'Code - Visual Enrichment Prepare', 'Livia');
  setConnection(connections, 'Code - Visual Enrichment Prepare', 0, 'Needs Subjective AI Review', 0);
  setConnection(connections, 'Needs Subjective AI Review', 0, 'Livia', 0);
  setConnection(connections, 'Needs Subjective AI Review', 0, 'Merge AI Review Context', 0);
  setConnection(connections, 'Needs Subjective AI Review', 1, 'Gestor Tráfego', 0);
  setConnection(connections, 'Livia', 0, 'Merge AI Review Context', 1);
  setConnection(connections, 'Merge AI Review Context', 0, 'Gestor Tráfego', 0);
  removeConnection(connections, 'Livia', 'Gestor Tráfego');
}

function main() {
  const workflow = readJson(inputPath);

  syncCodeNode(workflow, 'Build Creative Requests', 'meta-ads.performance-report-2.build-creative-requests.js');
  ensureGetCreativeHttpNode(workflow);
  syncCodeNode(workflow, 'Get Image', 'meta-ads.performance-report-2.resolve-creative-media.js');
  syncCodeNode(workflow, 'Code - Visual Enrichment Prepare', 'meta-ads.performance-report-2.prepare-visual-groups.js');
  ensureHttpNodeShape(workflow);
  ensureAiNodeShape(workflow);
  ensureAiRoutingNodes(workflow);
  ensureAiRoutingConnections(workflow);

  writeJson(outputPath, workflow);

  const summary = {
    input: inputPath,
    output: outputPath,
    nodes: workflow.nodes.length,
    connections: Object.keys(workflow.connections || {}).length,
    syncedHelpers: [
      'Build Creative Requests',
      'Get Image',
      'Code - Visual Enrichment Prepare',
    ],
    validatedNodes: [
      'Get Creative',
      'Needs Subjective AI Review',
      'Merge AI Review Context',
      'Gestor Tráfego',
      'Livia',
    ],
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
