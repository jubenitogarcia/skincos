import { sanitizeErrorMessage, sanitizeText } from './sanitize.mjs';

const integrationMatchers = [
  ['Meta Ads', /facebook|meta/i],
  ['Google', /google/i],
  ['OpenAI', /openai/i],
  ['WhatsApp/Evolution', /evolution|whatsapp/i],
  ['HTTP API', /httprequest|http.?request/i],
  ['PostgreSQL', /postgres/i],
  ['Queue', /rabbitmq|redis|sqs|kafka/i],
  ['Worker', /cloudflare|worker/i],
];

function nodesOf(workflow) {
  return Array.isArray(workflow?.nodes) ? workflow.nodes : [];
}

function connectionsOf(workflow) {
  return workflow?.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
}

export function connectionCount(connections) {
  return Object.values(connections || {}).reduce((total, typeMap) => total + Object.values(typeMap || {}).reduce(
    (inner, outputSets) => inner + (Array.isArray(outputSets) ? outputSets.flat().length : 0), 0,
  ), 0);
}

export function integrationNames(nodes) {
  const types = nodes.map((node) => typeof node === 'string' ? node : `${node.type || ''} ${node.name || ''}`).join(' ');
  return integrationMatchers.filter(([, matcher]) => matcher.test(types)).map(([name]) => name);
}

export function workflowListRecord(workflow) {
  const nodes = nodesOf(workflow);
  return {
    id: sanitizeText(workflow.id, 120),
    name: sanitizeText(workflow.name, 240),
    active: Boolean(workflow.active),
    archived: Boolean(workflow.isArchived),
    project: workflow.projectName ? sanitizeText(workflow.projectName, 180) : null,
    folder: workflow.folderName ? sanitizeText(workflow.folderName, 180) : null,
    created_at: workflow.createdAt || null,
    updated_at: workflow.updatedAt || null,
    node_count: Number.isFinite(Number(workflow.nodeCount)) ? Number(workflow.nodeCount) : nodes.length,
    connection_count: Number.isFinite(Number(workflow.connectionCount)) ? Number(workflow.connectionCount) : connectionCount(connectionsOf(workflow)),
    available_in_mcp: Boolean(workflow.settings?.availableInMCP),
    tags: Array.isArray(workflow.tags) ? workflow.tags.slice(0, 30).map((tag) => sanitizeText(tag, 120)) : [],
  };
}

function nodeId(index) {
  return `node_${index + 1}`;
}

function scalarWorkflowReference(value) {
  if (typeof value === 'string' || typeof value === 'number') return sanitizeText(value, 120);
  if (value && typeof value === 'object') return sanitizeText(value.id || value.value || value.name || '', 120);
  return null;
}

function inspectNodeParameters(node) {
  const parameters = node?.parameters && typeof node.parameters === 'object' ? node.parameters : {};
  const candidate = parameters.workflowId || parameters.workflow || parameters.workflowId?.value;
  return scalarWorkflowReference(candidate);
}

function credentialReferenceCount(nodes) {
  return nodes.reduce((total, node) => total + (node?.credentials && typeof node.credentials === 'object' ? Object.keys(node.credentials).length : 0), 0);
}

export function workflowGraph(workflow) {
  const nodes = nodesOf(workflow);
  const byName = new Map(nodes.map((node, index) => [node.name, nodeId(index)]));
  const edges = [];
  for (const [sourceName, typeMap] of Object.entries(connectionsOf(workflow))) {
    for (const [outputType, outputSets] of Object.entries(typeMap || {})) {
      for (const set of Array.isArray(outputSets) ? outputSets : []) {
        for (const target of Array.isArray(set) ? set : []) {
          if (byName.has(sourceName) && byName.has(target?.node)) {
            edges.push({ from: byName.get(sourceName), to: byName.get(target.node), output: sanitizeText(outputType, 80), input_index: Number(target?.index ?? 0) });
          }
        }
      }
    }
  }
  const incoming = new Set(edges.map((edge) => edge.to));
  return {
    workflow_id: sanitizeText(workflow.id, 120),
    nodes: nodes.map((node, index) => ({
      id: nodeId(index),
      name: sanitizeText(node.name || `Node ${index + 1}`, 180),
      type: sanitizeText(node.type || 'unknown', 220),
      position: Array.isArray(node.position) ? node.position.slice(0, 2).map((value) => Number(value) || 0) : [0, 0],
      disabled: Boolean(node.disabled),
    })),
    connections: edges.slice(0, 1000),
    main_path_starts: nodes.map((_, index) => nodeId(index)).filter((id) => !incoming.has(id)).slice(0, 50),
    branches: edges.length > nodes.length - 1,
    error_workflow: scalarWorkflowReference(workflow.settings?.errorWorkflow) || null,
    subworkflows: nodes.filter((node) => /executeworkflow/i.test(node.type || '')).map(inspectNodeParameters).filter(Boolean).slice(0, 50),
  };
}

export function workflowDependencies(workflow) {
  const nodes = nodesOf(workflow);
  const kinds = nodes.map((node) => `${node.type || ''} ${node.name || ''}`);
  const select = (matcher) => nodes.filter((node) => matcher.test(`${node.type || ''} ${node.name || ''}`)).map((node) => sanitizeText(node.type || node.name, 220)).slice(0, 50);
  return {
    workflow_id: sanitizeText(workflow.id, 120),
    execute_workflow: nodes.filter((node) => /executeworkflow/i.test(node.type || '')).map(inspectNodeParameters).filter(Boolean).slice(0, 50),
    webhooks: select(/webhook/i),
    schedules: select(/schedule|cron/i),
    databases: select(/postgres|mysql|mongo|sqlite|supabase/i),
    queues: select(/rabbitmq|redis|sqs|kafka/i),
    workers: select(/cloudflare|worker/i),
    external_integrations: integrationNames(nodes),
    skincos_systems: kinds.filter((kind) => /skincos|orb|crm|booking|evolution|whatsapp/i.test(kind)).map((kind) => sanitizeText(kind, 220)).slice(0, 50),
    error_workflow: scalarWorkflowReference(workflow.settings?.errorWorkflow) || null,
  };
}

export function workflowSummary(workflow) {
  const nodes = nodesOf(workflow);
  const graph = workflowGraph(workflow);
  const triggers = nodes.filter((node) => /trigger|webhook|schedule|cron/i.test(node.type || '')).map((node) => sanitizeText(node.type, 220)).slice(0, 50);
  const integrations = integrationNames(nodes);
  const risks = [
    /httprequest/i.test(nodes.map((node) => node.type).join(' ')) && 'external HTTP requests',
    /code/i.test(nodes.map((node) => node.type).join(' ')) && 'custom code execution inside workflow runtime',
    /postgres|mysql|mongo|supabase/i.test(nodes.map((node) => node.type).join(' ')) && 'database integration',
    /executeworkflow/i.test(nodes.map((node) => node.type).join(' ')) && 'subworkflow dependency',
  ].filter(Boolean);
  return {
    ...workflowListRecord(workflow),
    inferred_purpose: `Automation with ${triggers.length ? triggers.join(', ') : 'no detected trigger'} and ${integrations.length ? integrations.join(', ') : 'internal nodes'}.`,
    nodes: nodes.map((node, index) => ({ id: nodeId(index), name: sanitizeText(node.name || '', 180), type: sanitizeText(node.type || '', 220), disabled: Boolean(node.disabled) })),
    connections: graph.connections,
    triggers,
    subworkflows: graph.subworkflows,
    external_integrations: integrations,
    error_handling: { error_workflow: graph.error_workflow, error_trigger_present: nodes.some((node) => /errortrigger/i.test(node.type || '')) },
    credential_reference_count: credentialReferenceCount(nodes),
    apparent_risks: risks,
  };
}

export function matchesWorkflow(workflow, filter) {
  const nodeTypes = nodesOf(workflow).length ? nodesOf(workflow).map((node) => `${node.name || ''} ${node.type || ''}`) : (workflow.nodeTypes || []);
  const terms = [workflow.name, workflow.description, ...(workflow.tags || []), ...nodeTypes].join(' ').toLowerCase();
  const query = String(filter.query || '').trim().toLowerCase();
  if (query && !terms.includes(query)) return false;
  if (Array.isArray(filter.tags) && filter.tags.length && !filter.tags.every((tag) => (workflow.tags || []).some((existing) => String(existing).toLowerCase().includes(String(tag).toLowerCase())))) return false;
  if (Array.isArray(filter.node_types) && filter.node_types.length && !filter.node_types.every((type) => nodeTypes.some((node) => String(typeof node === 'string' ? node : node.type || '').toLowerCase().includes(String(type).toLowerCase())))) return false;
  if (Array.isArray(filter.integrations) && filter.integrations.length && !filter.integrations.every((name) => integrationNames(nodeTypes).some((integration) => integration.toLowerCase().includes(String(name).toLowerCase())))) return false;
  if (typeof filter.active === 'boolean' && Boolean(workflow.active) !== filter.active) return false;
  const updated = workflow.updatedAt ? Date.parse(workflow.updatedAt) : NaN;
  if (filter.updated_after && (!Number.isFinite(updated) || updated < Date.parse(filter.updated_after))) return false;
  if (filter.updated_before && (!Number.isFinite(updated) || updated > Date.parse(filter.updated_before))) return false;
  return true;
}

function walkError(value, state, depth = 0) {
  if (depth > 12 || state.visited > 3000 || value === null || value === undefined) return;
  state.visited += 1;
  if (Array.isArray(value)) return value.slice(0, 200).forEach((item) => walkError(item, state, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/lastNodeExecuted|nodeName|errorNode/i.test(key) && !state.node && typeof item === 'string') state.node = sanitizeText(item, 180);
    if (/nodeType|type/i.test(key) && !state.nodeType && typeof item === 'string' && /n8n|node/i.test(item)) state.nodeType = sanitizeText(item, 220);
    if (/httpCode|statusCode/i.test(key) && !state.httpCode && (typeof item === 'number' || /^\d{3}$/.test(String(item)))) state.httpCode = Number(item);
    if (/message|description/i.test(key) && !state.message && typeof item === 'string') state.message = sanitizeErrorMessage(item);
    if (/stack/i.test(key) && !state.stack && typeof item === 'string') state.stack = sanitizeErrorMessage(item).split('\n').slice(0, 5).join('\n');
    if (/retry|attempt/i.test(key) && state.retry === null && (typeof item === 'number' || typeof item === 'boolean')) state.retry = item;
    if (item && typeof item === 'object') walkError(item, state, depth + 1);
  }
}

export function executionErrorDetails(serialized) {
  const state = { node: null, nodeType: null, message: null, stack: null, httpCode: null, retry: null, visited: 0 };
  try {
    const parse = globalThis.__skincosFlattedParse || JSON.parse;
    walkError(parse(serialized || '{}'), state);
  } catch {
    state.message = 'Execution data is unavailable or exceeds the safe inspection limit.';
  }
  return { node: state.node, node_type: state.nodeType, message: state.message, stack: state.stack, http_status: state.httpCode, retry: state.retry };
}
