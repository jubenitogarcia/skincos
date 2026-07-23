#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createMetaAdsPublishStructuredSchema } = require('./lib/meta-ads-publish-structured-schema');

const workflowPath = path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const schema = JSON.stringify(createMetaAdsPublishStructuredSchema(), null, 2);
const model = workflow.nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)');
if (!model) throw new Error('OpenAI Chat Model (Agent) not found.');
model.parameters.responsesApiEnabled = true;
model.parameters.options ||= {};
model.parameters.options.textFormat = {
  textOptions: {
    type: 'json_schema',
    name: 'meta_ads_publish',
    schema,
  },
};
workflow.nodes = workflow.nodes.filter((node) => node.name !== 'Meta Publish Structured Output');
delete workflow.connections['Meta Publish Structured Output'];
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ model: model.name, parser_removed: true, schema_bytes: schema.length }));
