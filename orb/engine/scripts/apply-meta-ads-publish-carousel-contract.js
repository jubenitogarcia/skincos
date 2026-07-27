#!/usr/bin/env node
'use strict';

// Applies the non-Code-node portion of the carousel contract to a workflow
// snapshot. Code nodes are injected separately from workflow-src so the same
// reviewed sources drive both the test fixture and the n8n definition.
const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'workflows', 'meta-ads-publish.current.json'));
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const agent = workflow.nodes.find((node) => node.name === 'Visual Grouping Agent');
if (!agent) throw new Error('Visual Grouping Agent not found.');

const carouselPrompt = `

Contrato adicional v3 para lote estático: quando duas a dez imagens contam a
mesma narrativa em sequência (por exemplo, cards de uma oferta), defina o
grupo como media_mode="carousel" e atribua todas como role="carousel_card".
Informe carousel_card_index inteiro e contínuo de 1 até N na ordem narrativa
que aparece visualmente. Não use nomes, IDs ou ordem do Drive. Não classifique
como carousel se forem as três variações de posicionamento da mesma arte; nesse
caso use media_mode="static_only" e os papéis feed/banner/stories. Em v3 cada
grupo deve devolver media_mode. Um carousel não pode conter vídeo, nem cards
duplicados, e precisa de 2 a 10 imagens. Ambiguidade ou confiança abaixo de
0,75 deve bloquear o lote.`;

agent.parameters = agent.parameters || {};
agent.parameters.text = `${String(agent.parameters.text || '').trim()}${carouselPrompt}`;
agent.parameters.options = agent.parameters.options || {};
agent.parameters.options.systemMessage = `${String(agent.parameters.options.systemMessage || '').trim()}${carouselPrompt}`;

workflow.meta = { ...(workflow.meta || {}), meta_ads_publish_contract: 'carousel_v1' };
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ workflow_id: workflow.id, node: agent.name, contract: 'carousel_v1' }));
