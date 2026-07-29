const fs = require('fs');
const path = require('path');
const { sha256, semanticCopy } = require('./canonical');
const definitions = require('../schemas/definitions');
let Ajv;
try { Ajv = require('ajv'); } catch {}

function loadSchema(name) {
  const file = path.join(__dirname, '..', 'schemas', `${name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}.schema.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateShape(value, schema, pointer = '$', errors = []) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push(`${pointer} must be object`);
    else {
      for (const key of schema.required || []) if (!(key in value)) errors.push(`${pointer}.${key} is required`);
      if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties[key]) errors.push(`${pointer}.${key} is not allowed`);
      for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateShape(value[key], child, `${pointer}.${key}`, errors);
    }
  } else if (schema.type === 'array' && !Array.isArray(value)) errors.push(`${pointer} must be array`);
  else if (schema.type === 'string' && typeof value !== 'string') errors.push(`${pointer} must be string`);
  else if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${pointer} must be boolean`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${pointer} has invalid enum value`);
  return errors;
}

function validate(name, value) {
  const schema = definitions[name] || loadSchema(name);
  if (Ajv) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const check = ajv.compile({ $schema: 'http://json-schema.org/draft-07/schema#', ...schema });
    if (!check(value)) throw new Error(`Invalid ${name}: ${ajv.errorsText(check.errors)}`);
    return true;
  }
  const errors = validateShape(value, schema);
  if (errors.length) throw new Error(`Invalid ${name}: ${errors.join('; ')}`);
  return true;
}

function lockHash(value) { return sha256(semanticCopy(value)); }

module.exports = { loadSchema, validate, lockHash };
