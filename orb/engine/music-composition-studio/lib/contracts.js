const { definitions } = require('./schema-definitions');
const aliases = Object.fromEntries(Object.keys(definitions).map((name) => [name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), name]));

function check(schema, value, path = '$') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const required of schema.required || []) if (value[required] === undefined) throw new Error(`${path}.${required} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) throw new Error(`${path}.${key} is not allowed`);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) check(schema.additionalProperties, value[key], `${path}.${key}`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (value[key] !== undefined) check(child, value[key], `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} must contain at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} must contain at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) throw new Error(`${path} must contain unique items`);
    value.forEach((item, index) => check(schema.items || {}, item, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    if (schema.minLength && value.length < schema.minLength) throw new Error(`${path} must not be empty`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw new Error(`${path} must match ${schema.pattern}`);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) throw new Error(`${path} must be a ${schema.type}`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} must be >= ${schema.minimum}`);
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} must be <= ${schema.maximum}`);
}

function validate(name, value) {
  const schemaName = definitions[name] ? name : aliases[name];
  if (!schemaName) throw new Error(`Unknown Music Composition Studio schema: ${name}`);
  check(definitions[schemaName], value);
  return value;
}

module.exports = { validate, definitions, check };
