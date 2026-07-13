#!/usr/bin/env node
/*
 * Dry-run determinístico do roteador de cascata do Harmonia.
 * Não depende do n8n rodando; valida regras de prioridade/fallback/safe-mode.
 */

const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const workflowPath = process.argv[2] || path.join(runtimePaths.workflowsDir, 'harmonia.safe.post.json');

if (!fs.existsSync(workflowPath)) {
  console.error(`Arquivo não encontrado: ${workflowPath}`);
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const router = wf.nodes.find((n) => n.name === 'Keyword Router Cascata');
if (!router) {
  console.error('Node "Keyword Router Cascata" não encontrado no workflow.');
  process.exit(1);
}

const jsCode = String(router.parameters?.jsCode || '');
const matchRules = jsCode.match(/const RULES = (\[[\s\S]*?\]);\n\nfunction norm/);
if (!matchRules) {
  console.error('Não foi possível extrair RULES do node Keyword Router Cascata.');
  process.exit(1);
}

const RULES = JSON.parse(matchRules[1]);

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function hasPlaceholderTemplate(rule) {
  const text = (Array.isArray(rule?.mensagens) ? rule.mensagens.join(' ') : String(rule?.mensagens || '')).toUpperCase();
  return /(XXX-?FEIRA|XX\/XX|XX:XX|\bXX\b)/.test(text);
}

function containsKeyword(text, keyword) {
  const k = norm(keyword);
  if (!k) return false;
  if (k.includes(' ')) return text.includes(k);
  const re = new RegExp('(?:^|\\s)' + escapeRegex(k) + '(?:\\s|$)');
  return re.test(text);
}

const SAFE_MODE_DISABLE_CAMPAIGN_RULES = true;

const activeRules = RULES
  .map((r, idx) => ({ ...r, __idx: idx }))
  .filter((r) => Array.isArray(r.keywords) && r.keywords.some((k) => String(k || '').trim()))
  .filter((r) => !hasPlaceholderTemplate(r))
  .filter((r) => !(SAFE_MODE_DISABLE_CAMPAIGN_RULES && Boolean(r.revisar_preco_data_campanha)))
  .sort((a, b) => (Number(a.prioridade ?? 9999) - Number(b.prioridade ?? 9999)) || (a.__idx - b.__idx));

function matchMessage(msg) {
  const text = norm(msg);
  let matched = null;
  for (const rule of activeRules) {
    for (const kw of rule.keywords || []) {
      if (containsKeyword(text, kw)) {
        matched = rule;
        break;
      }
    }
    if (matched) break;
  }
  return matched ? matched.codigo : null;
}

const tests = [
  { id: 'D1', msg: 'Quero hialuronidase para desfazer preenchimento', expected: 'Hialuronidase' },
  { id: 'D2', msg: 'Qual o endereco novo hamburgo?', expected: 'Localização Novo Hamburgo' },
  { id: 'D3', msg: 'Obrigada pelo atendimento', expected: 'Agradecimento' },
  { id: 'D4', msg: 'Tenho acne e poros, queria microagulhamento', expected: 'Microagulhamento' },
  { id: 'D5', msg: 'Quero preenchimento intimo', expected: 'Preenchimento Íntimo' },
  { id: 'D6', msg: 'Tem horario amanhã?', expected: null },
  { id: 'D7', msg: 'Me manda a oferta do mês', expected: null },
  { id: 'D8', msg: 'Quero botox full face', expected: null },
  { id: 'D9', msg: 'Quero botox', expected: null },
  { id: 'D10', msg: 'Preciso de revisão do procedimento', expected: 'Revisão' },
];

let passed = 0;
for (const t of tests) {
  const got = matchMessage(t.msg);
  const ok = got === t.expected;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${t.id}\tgot=${got || 'null'}\texpected=${t.expected || 'null'}`);
}

const placeholderDisabled = RULES.filter((r) => hasPlaceholderTemplate(r)).map((r) => r.codigo);
const campaignDisabled = RULES.filter((r) => Boolean(r.revisar_preco_data_campanha)).map((r) => r.codigo);

console.log('\nResumo:');
console.log(`- Total keyword rules: ${RULES.length}`);
console.log(`- Ativas (safe mode): ${activeRules.length}`);
console.log(`- Desativadas por placeholder: ${placeholderDisabled.length} (${placeholderDisabled.join(', ')})`);
console.log(`- Desativadas por campanha: ${campaignDisabled.length}`);
console.log(`- Testes: ${passed}/${tests.length} aprovados`);

process.exit(passed === tests.length ? 0 : 2);
