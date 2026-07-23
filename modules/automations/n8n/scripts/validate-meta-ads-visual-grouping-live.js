#!/usr/bin/env node
'use strict';

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CONFIG_URL = 'https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config';

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const Client = loadPgClient();
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const workflowResult = await client.query(
      `SELECT nodes, connections, "versionId", "versionCounter", active, "activeVersionId"
         FROM n8n_runtime.workflow_entity WHERE id=$1`,
      [WORKFLOW_ID],
    );
    const workflow = workflowResult.rows[0];
    assert(workflow, 'Workflow live ausente.');
    const nodes = parseJson(workflow.nodes, []);
    const connections = parseJson(workflow.connections, {});
    const tokenResult = await client.query(
      `SELECT value FROM n8n_runtime.variables WHERE key='TOKEN_VAULT_API_TOKEN' LIMIT 1`,
    );
    const token = String(tokenResult.rows[0]?.value || '').trim();
    assert(token, 'Token operacional do gateway ausente.');

    const response = await fetch(CONFIG_URL, { headers: { Authorization: `Bearer ${token}` } });
    const config = await response.json();
    assert(response.ok, `Gateway config HTTP ${response.status}.`);
    assert(config.ok === true && config.ready === true, `Gateway nao esta pronto: ${JSON.stringify(config.invalid || config.error || {})}`);

    const adapter = nodes.find((node) => node.name === 'Build Meta API Params From Vault');
    assert(adapter?.parameters?.jsCode, 'Adapter live ausente.');
    const executeAdapter = new Function('$input', adapter.parameters.jsCode);
    const adapted = executeAdapter({ first: () => ({ json: config }) });
    const byDestination = Object.fromEntries(adapted.map((item) => [item.json.destination_group, item.json]));
    const barra = byDestination.BarraShoppingSul;
    const nh = byDestination['Novo Hamburgo'];
    assert(barra?.landing_pages_by_creative_group?.DEFAULT === 'https://espacofacial.com/agendamento?unit=barrashoppingsul', 'URL default da Barra divergente.');
    assert(nh?.landing_pages_by_creative_group?.DEFAULT === 'https://espacofacial.com/agendamento?unit=novo-hamburgo', 'URL default de Novo Hamburgo divergente.');

    const visionModel = nodes.find((node) => node.name === 'OpenAI Vision Model (Grouping)');
    const visualAgent = nodes.find((node) => node.name === 'Visual Grouping Agent');
    assert(visionModel?.credentials?.openAiApi?.id === 'd5x9D1q8y2QXDeUD', 'Credencial OpenAI live divergente.');
    assert(visualAgent?.parameters?.options?.passthroughBinaryImages === true, 'Agente visual nao recebe binarios automaticamente.');
    assert(connections?.['Download File']?.main?.[0]?.[0]?.node === 'Prepare Visual Grouping Batch', 'Rota visual live divergente.');

    console.log(JSON.stringify({
      workflow_id: WORKFLOW_ID,
      version_id: workflow.versionId,
      version_counter: Number(workflow.versionCounter),
      workflow_active: workflow.active,
      active_version_id: workflow.activeVersionId,
      gateway_ready: true,
      gateway_destinations: Array.isArray(config.destinations) ? config.destinations.length : 0,
      adapter_urls: {
        BarraShoppingSul: barra.landing_pages_by_creative_group.DEFAULT,
        Novo_Hamburgo: nh.landing_pages_by_creative_group.DEFAULT,
      },
      visual_grouping_agent_present: true,
      openai_credential_reused: true,
      meta_mutations_performed: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
