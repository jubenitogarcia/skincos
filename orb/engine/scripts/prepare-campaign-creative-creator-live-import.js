#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['--input', '--output', '--credential-id', '--credential-name'].includes(argument)) {
      result[argument.slice(2).replaceAll('-', '_')] = argv[++index];
    }
  }
  return result;
}

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required at runtime`);
  return normalized;
}

function prepareLiveImport(workflow, { credentialId, credentialName }) {
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
    throw new Error('Workflow export must contain a nodes array');
  }
  const runtimeCredentialId = required(credentialId, 'credential id');
  const runtimeCredentialName = required(credentialName, 'credential name');
  const output = JSON.parse(JSON.stringify(workflow));
  let patchedNodes = 0;

  for (const node of output.nodes) {
    if (node.type !== '@n8n/n8n-nodes-langchain.lmChatOpenAi') continue;
    node.credentials = {
      ...(node.credentials || {}),
      openAiApi: {
        id: runtimeCredentialId,
        name: runtimeCredentialName,
      },
    };
    patchedNodes += 1;
  }

  if (!patchedNodes) throw new Error('No OpenAI chat model nodes found in workflow export');
  return { workflow: output, patchedNodes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = required(args.input, 'input');
  const outputPath = required(args.output, 'output');
  const inputAbsolute = path.resolve(inputPath);
  const outputAbsolute = path.resolve(outputPath);
  if (inputAbsolute === outputAbsolute) throw new Error('Live import preparation must not overwrite its input');

  const workflow = JSON.parse(fs.readFileSync(inputAbsolute, 'utf8').replace(/^\uFEFF/, ''));
  const prepared = prepareLiveImport(workflow, {
    credentialId: args.credential_id,
    credentialName: args.credential_name,
  });
  fs.mkdirSync(path.dirname(outputAbsolute), { recursive: true });
  fs.writeFileSync(outputAbsolute, JSON.stringify(prepared.workflow, null, 2) + '\n');
  process.stdout.write(`Prepared live CCG import with ${prepared.patchedNodes} runtime credential references\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write((error && error.stack ? error.stack : error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { prepareLiveImport };
