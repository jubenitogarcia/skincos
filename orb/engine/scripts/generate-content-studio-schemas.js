const fs = require('fs');
const path = require('path');
const definitions = require('../content-studio-v2/schemas/definitions');
const out = path.join(__dirname, '..', 'content-studio-v2', 'schemas');
fs.mkdirSync(out, { recursive: true });
function sample(schema) {
  if (schema.anyOf) return sample(schema.anyOf.find((item) => item.type !== 'null') || schema.anyOf[0]);
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') return Object.fromEntries((schema.required || []).map((key) => [key, sample(schema.properties[key])]));
  if (schema.type === 'array') return [];
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  if (schema.type === 'boolean') return false;
  return 'fixture';
}
for (const [name, schema] of Object.entries(definitions)) {
  const example = sample(schema);
  const invalid = { ...example };
  if (schema.required?.[0]) delete invalid[schema.required[0]];
  fs.writeFileSync(path.join(out, `${name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}.schema.json`), `${JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', $id: `https://skincos.local/ccg/${name}`, title: name, examples: [example], 'x-invalid-examples': [invalid], ...schema }, null, 2)}\n`);
}
console.log(`Generated ${Object.keys(definitions).length} CCG schemas in ${out}`);
