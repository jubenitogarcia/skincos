#!/usr/bin/env node

const fs = require('fs');

const inputPath = process.argv[2] || 'workflows/livia.json';
const outputPath = process.argv[3] || inputPath;

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const telegram = workflow.nodes.find((node) => node.name === 'Inform Success (2)');
if (!telegram) throw new Error('Node not found: Inform Success (2)');

telegram.parameters.text = `={{ (() => {
  function str(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function htmlEscape(value) {
    return str(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const base = $json.whatsappMessage || $("Compose (3)").first().json.whatsappMessage || "";
  return htmlEscape(base);
})() }}`;

telegram.parameters.additionalFields = {
  ...(telegram.parameters.additionalFields || {}),
  appendAttribution: false,
  disable_web_page_preview: true,
  parse_mode: 'HTML',
};

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({
  inputPath,
  outputPath,
  node: 'Inform Success (2)',
  parse_mode: telegram.parameters.additionalFields.parse_mode,
  disable_web_page_preview: telegram.parameters.additionalFields.disable_web_page_preview,
  appendAttribution: telegram.parameters.additionalFields.appendAttribution,
}, null, 2));
