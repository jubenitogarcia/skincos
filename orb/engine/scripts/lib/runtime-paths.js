'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = process.env.N8N_ROOT || repoRoot;
const runtimeHome =
  process.env.N8N_RUNTIME_HOME ||
  (process.platform === 'win32' ? 'C:\\CodexRuntime\\n8n' : '/mnt/c/CodexRuntime/n8n');
const dataHome = process.env.N8N_DATA_HOME || path.join(runtimeHome, 'n8n-home');
const cloudflaredHome = process.env.CLOUDFLARED_HOME || path.join(runtimeHome, 'cloudflared');

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
  envFile: process.env.N8N_ENV_FILE || path.join(runtimeHome, 'env', 'n8n.env'),
  tmpDir: process.env.N8N_TMP_DIR || path.join(runtimeHome, 'tmp'),
  dbPath: process.env.N8N_DB_PATH || path.join(dataHome, 'database.sqlite'),
  configPath: process.env.N8N_CONFIG_PATH || path.join(dataHome, 'config'),
  healthDir: process.env.N8N_HEALTH_DIR || path.join(runtimeHome, 'health'),
  logDir: process.env.N8N_LOG_DIR || path.join(runtimeHome, 'logs'),
  binaryDataDir: process.env.N8N_BINARY_DATA_DIR || path.join(runtimeHome, 'binary-data'),
  evolutionEnvFile:
    process.env.EVOLUTION_ENV_FILE || path.join(runtimeHome, 'env', 'evolution-api.env'),
  evolutionInstancesDir:
    process.env.EVOLUTION_INSTANCES_DIR || path.join(runtimeHome, 'evolution-api', 'instances'),
  evolutionStoreDir:
    process.env.EVOLUTION_STORE_DIR || path.join(runtimeHome, 'evolution-api', 'store'),
  resolveFromRoot,
  resolveFromRuntime,
};
