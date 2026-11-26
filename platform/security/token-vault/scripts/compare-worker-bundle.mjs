#!/usr/bin/env node
// Compara o bundle implantado do Token Vault com o bundle gerado desta árvore,
// declaração por declaração. Serve para provar, antes de uma promoção, que o
// candidato é "produção + exatamente as mudanças esperadas".
//
// Uso:
//   node scripts/compare-worker-bundle.mjs --esbuild <binário> --deployed <arquivo>
//        [--entry src/compat-entry.js] [--allow nomeA,nomeB,...] [--json]
//
// <arquivo> é o código baixado do Worker (o corpo multipart devolvido pela API
// da Cloudflare ou o .js já extraído). Nada é enviado para fora: o script só
// lê arquivos locais e roda o esbuild indicado.
//
// Saída 0: bundles equivalentes, ou toda diferença está na lista --allow.
// Saída 1: há diferença fora da lista. Saída 2: uso incorreto.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const out = { entry: 'src/compat-entry.js', allow: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') out.json = true;
    else if (arg === '--esbuild') out.esbuild = argv[++index];
    else if (arg === '--deployed') out.deployed = argv[++index];
    else if (arg === '--entry') out.entry = argv[++index];
    else if (arg === '--allow') out.allow = String(argv[++index] || '').split(',').map((name) => name.trim()).filter(Boolean);
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  if (!out.esbuild || !out.deployed) throw new Error('informe --esbuild e --deployed');
  return out;
}

// A API devolve multipart/form-data com um módulo; aceita também o .js puro.
export function extractModule(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('--')) return text;
  const boundary = text.slice(0, text.indexOf('\n'));
  const parts = text.split(`${boundary}\n`).filter((part) => part.trim() && !part.startsWith('--'));
  if (parts.length !== 1) throw new Error(`esperado 1 módulo no multipart, encontrados ${parts.length}`);
  const body = parts[0].slice(parts[0].indexOf('\n\n') + 2);
  const end = body.lastIndexOf(`\n${boundary}--`);
  return end === -1 ? body : body.slice(0, end);
}

// Divide o bundle já normalizado em declarações de topo, por nome. `__name()`
// e comentários não mudam o comportamento e ficam fora da comparação.
export function splitDeclarations(code) {
  const chunks = new Map();
  let name = '';
  let lines = [];
  const flush = () => {
    if (!name) return;
    let key = name;
    for (let suffix = 2; chunks.has(key); suffix += 1) key = `${name}#${suffix}`;
    chunks.set(key, lines.join('\n'));
  };
  for (const line of code.split('\n')) {
    if (!line.trim() || /^\s*\/\//.test(line) || /^__name\(/.test(line)) continue;
    const match = /^(?:async\s+)?function\*?\s+([\w$]+)|^(?:var|let|const|class)\s+([\w$]+)|^(export)\b/.exec(line);
    if (match) {
      flush();
      name = match[1] || match[2] || match[3];
      lines = [];
    } else if (!name) {
      name = '(preâmbulo)';
    }
    lines.push(line);
  }
  flush();
  return chunks;
}

export function compareDeclarations(deployed, local) {
  const onlyDeployed = [...deployed.keys()].filter((key) => !local.has(key));
  const onlyLocal = [...local.keys()].filter((key) => !deployed.has(key));
  const changed = [...deployed.keys()].filter((key) => local.has(key) && local.get(key) !== deployed.get(key));
  return { onlyDeployed, onlyLocal, changed };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), 'token-vault-bundle-'));
  try {
    const run = (params) => execFileSync(resolve(args.esbuild), [...params, '--log-level=error'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const normalize = (file, out) => run([file, '--format=esm', '--target=es2022', `--outfile=${out}`]);
    const deployedRaw = join(work, 'deployed.raw.js');
    writeFileSync(deployedRaw, extractModule(readFileSync(args.deployed, 'utf8')));
    const localRaw = join(work, 'local.raw.js');
    run([args.entry, '--bundle', '--format=esm', '--keep-names', '--target=es2022', `--outfile=${localRaw}`]);
    normalize(deployedRaw, join(work, 'deployed.js'));
    normalize(localRaw, join(work, 'local.js'));
    const deployed = splitDeclarations(readFileSync(join(work, 'deployed.js'), 'utf8'));
    const local = splitDeclarations(readFileSync(join(work, 'local.js'), 'utf8'));
    const diff = compareDeclarations(deployed, local);
    const all = [...diff.onlyDeployed, ...diff.onlyLocal, ...diff.changed];
    const unexpected = all.filter((key) => !args.allow.includes(key));
    const digest = (map) => createHash('sha256').update([...map.entries()].map(([key, value]) => `${key}\n${value}`).join('\n')).digest('hex');
    const report = {
      equivalent: all.length === 0,
      accepted: unexpected.length === 0,
      deployed_declarations: deployed.size,
      local_declarations: local.size,
      deployed_sha256: digest(deployed),
      local_sha256: digest(local),
      only_in_deployed: diff.onlyDeployed,
      only_in_local: diff.onlyLocal,
      changed: diff.changed,
      unexpected,
    };
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`declarações: implantado ${report.deployed_declarations}, local ${report.local_declarations}`);
      console.log(`sha256 normalizado: implantado ${report.deployed_sha256}`);
      console.log(`                    local      ${report.local_sha256}`);
      console.log(`só no implantado: ${diff.onlyDeployed.join(', ') || '-'}`);
      console.log(`só no local:      ${diff.onlyLocal.join(', ') || '-'}`);
      console.log(`alteradas:        ${diff.changed.join(', ') || '-'}`);
      console.log(report.equivalent ? 'RESULTADO: EQUIVALENTE' : unexpected.length ? `RESULTADO: DIFERENÇA NÃO ESPERADA (${unexpected.join(', ')})` : 'RESULTADO: SÓ AS DIFERENÇAS ESPERADAS');
    }
    process.exit(unexpected.length ? 1 : 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
