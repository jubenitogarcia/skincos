'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = process.env.N8N_ROOT || repoRoot;
const runtimeHome =
  process.env.N8N_RUNTIME_HOME ||
  '/var/lib/skincos-runtime/orb';
const dataHome = process.env.N8N_DATA_HOME || path.join(runtimeHome, 'n8n-home');
const cloudflaredHome = process.env.CLOUDFLARED_HOME || '/etc/skincos/cloudflare/orb';

function resolveFromRoot(...parts) {
  return path.join(repoRoot, ...parts);
}

function resolveFromRuntime(...parts) {
  return path.join(runtimeRoot, ...parts);
}

module.exports = {
  repoRoot,
  runtimeRoot,
  runtimeHome,
  dataHome,
  cloudflaredHome,
  workflowsDir: process.env.N8N_WORKFLOWS_DIR || resolveFromRoot('workflows'),
  workflowSrcDir: resolveFromRoot('workflow-src'),
  envFile: process.env.N8N_ENV_FILE || '/etc/skincos/orb.env',
  tmpDir: process.env.N8N_TMP_DIR || '/tmp',
  dbPath: process.env.N8N_DB_PATH || path.join(dataHome, 'database.sqlite'),
  configPath: process.env.N8N_CONFIG_PATH || path.join(dataHome, 'config'),
  healthDir: process.env.N8N_HEALTH_DIR || path.join(runtimeHome, 'health'),
  logDir: process.env.N8N_LOG_DIR || '/var/log/skincos/orb',
  binaryDataDir: process.env.N8N_BINARY_DATA_DIR || path.join(dataHome, '.n8n', 'storage'),
  evolutionEnvFile:
    process.env.EVOLUTION_ENV_FILE || '/etc/skincos/messaging-whatsapp.env',
  evolutionInstancesDir:
    process.env.EVOLUTION_INSTANCES_DIR || '/var/lib/skincos-runtime/messaging-whatsapp/instances',
  evolutionStoreDir:
    process.env.EVOLUTION_STORE_DIR || '/var/lib/skincos-runtime/messaging-whatsapp/store',
  resolveFromRoot,
  resolveFromRuntime,
};
