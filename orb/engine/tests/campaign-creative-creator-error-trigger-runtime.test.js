'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const engineRoot = path.resolve(__dirname, '..');
const preloadPath = path.join(engineRoot, 'scripts', 'preload-n8n-error-workflow-bootstrap.js');
const bootstrapCorePath = path.join(engineRoot, 'scripts', 'n8n-error-workflow-bootstrap-core.js');
const starterPath = path.join(engineRoot, 'scripts', 'start-n8n-runtime.sh');
const unitPath = path.resolve(engineRoot, '..', '..', 'ops', 'runtime', 'units', 'orb.service');
const n8nRoot = process.env.N8N_GLOBAL_DIR || '/usr/local/lib/node_modules/n8n';
const servicePath = path.join(n8nRoot, 'dist', 'workflows', 'workflow-execution.service.js');
const runnerPath = path.join(n8nRoot, 'dist', 'workflow-runner.js');
const errorWorkflowPath = path.join(n8nRoot, 'dist', 'execution-lifecycle', 'execute-error-workflow.js');

test('Orb starts n8n through the error-workflow bootstrap', () => {
  const unit = fs.readFileSync(unitPath, 'utf8');
  const starter = fs.readFileSync(starterPath, 'utf8');
  assert.match(unit, /^ExecStart=__REPO_ROOT__\/orb\/engine\/scripts\/start-n8n-runtime\.sh$/m);
  assert.match(starter, /--require=\$preload/);
  assert.match(starter, /exec \/usr\/local\/bin\/n8n start/);
});

test('bootstrap preserves only the CCG recovery lineage in the native error payload', { skip: !fs.existsSync(servicePath) }, () => {
  const bootstrap = require(preloadPath);
  const nativeDispatcher = require(errorWorkflowPath);
  assert.equal(nativeDispatcher.executeErrorWorkflow.name, 'executeErrorWorkflowWithCcgRecovery');
  const fullRunData = {
    data: {
      resultData: {
        error: { message: 'synthetic failure' },
        runData: {
          'CCG-00 Capture Recovery Context': [{
            data: {
              main: [[{
                json: {
                  ccg_recovery_context: {
                    schema_version: '1.0.0',
                    run_id: 'run-native-error',
                    production_id: 'production-native-error',
                    content_id: 'content-native-error',
                    campaign_id: 'campaign-native-error',
                    request_hash: 'request-native-error',
                    idempotency_key: 'idempotency-native-error',
                    production_tier: 'STANDARD',
                    mode: 'DRY_RUN',
                    module: 'CCG-00',
                    checkpoint_module: 'CCG-00',
                    current_attempt: 1,
                    max_attempts: 3,
                    recovery_policy: {
                      dispatch_enabled: false,
                      allow_execution_retry: true,
                      allow_checkpoint_resume: true,
                      maximum_backoff_seconds: 900,
                      unapproved_metadata: 'must-not-pass-through',
                    },
                    secret: 'must-not-pass-through',
                  },
                },
              }]],
            },
          }],
        },
      },
    },
  };
  assert.equal(bootstrap.attachCcgRecoveryContext(fullRunData), true);
  assert.deepEqual(fullRunData.data.resultData.error.ccg_recovery_context, {
    schema_version: '1.0.0',
    run_id: 'run-native-error',
    production_id: 'production-native-error',
    content_id: 'content-native-error',
    campaign_id: 'campaign-native-error',
    request_hash: 'request-native-error',
    idempotency_key: 'idempotency-native-error',
    production_tier: 'STANDARD',
    mode: 'DRY_RUN',
    module: 'CCG-00',
    checkpoint_module: 'CCG-00',
    current_attempt: 1,
    max_attempts: 3,
    recovery_policy: {
      dispatch_enabled: false,
      allow_execution_retry: true,
      allow_checkpoint_resume: true,
      maximum_backoff_seconds: 900,
    },
  });
});

test('bootstrap resolves WorkflowRunner metadata before the runner is loaded', { skip: !fs.existsSync(runnerPath) }, () => {
  const probe = [
    `const { WorkflowExecutionService } = require(${JSON.stringify(servicePath)});`,
    `const { WorkflowRunner } = require(${JSON.stringify(runnerPath)});`,
    "const dependencies = Reflect.getMetadata('design:paramtypes', WorkflowExecutionService) || [];",
    "process.stdout.write(String(typeof dependencies[6]) + ':' + String(dependencies[6] === WorkflowRunner));",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--require', preloadPath, '-e', probe], {
    encoding: 'utf8',
    env: { ...process.env, N8N_GLOBAL_DIR: n8nRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function:true');
});

function installReflectMetadataShim() {
  if (typeof Reflect.defineMetadata === 'function' && typeof Reflect.getMetadata === 'function') return;
  const registry = new WeakMap();
  Reflect.defineMetadata = (key, value, target) => {
    let metadata = registry.get(target);
    if (!metadata) {
      metadata = new Map();
      registry.set(target, metadata);
    }
    metadata.set(key, value);
  };
  Reflect.getMetadata = (key, target) => registry.get(target)?.get(key);
}

test('bootstrap repairs WorkflowExecutionService metadata immediately before container resolution', () => {
  installReflectMetadataShim();
  const bootstrap = require(bootstrapCorePath);
  function FakeWorkflowExecutionService() {}
  function FakeWorkflowRunner() {}
  const dependencies = [function A() {}, function B() {}, function C() {}, function D() {}, function E() {}, function F() {}, undefined];
  Reflect.defineMetadata('design:paramtypes', dependencies, FakeWorkflowExecutionService);
  const fakeContainer = {
    get(token) {
      return (Reflect.getMetadata('design:paramtypes', token) || [])[6];
    },
  };

  assert.equal(
    bootstrap.patchContainerGet(fakeContainer, FakeWorkflowExecutionService, () => FakeWorkflowRunner),
    true,
  );
  assert.equal(fakeContainer.get(FakeWorkflowExecutionService), FakeWorkflowRunner);
  assert.equal(fakeContainer.__skincosCcgWorkflowExecutionRepair, true);
  assert.equal(
    bootstrap.patchContainerGet(fakeContainer, FakeWorkflowExecutionService, () => FakeWorkflowRunner),
    false,
  );
});

test('smoke-only drain waits for the native error execution before the CLI exits', async () => {
  const bootstrap = require(bootstrapCorePath);
  const exits = [];
  const fakeProcess = {
    env: { SKINCOS_AWAIT_ERROR_WORKFLOW: '1', SKINCOS_AWAIT_ERROR_WORKFLOW_TIMEOUT_MS: '1000' },
    exit(code) { exits.push(code); },
  };
  const drain = bootstrap.createCliErrorWorkflowDrain(fakeProcess, { timeoutMs: 1000 });
  fakeProcess.exit(1);
  drain.track(Promise.resolve());
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(exits, [1]);
});

test('smoke-only drain tracks the post-execution promise for native error workflows only', async () => {
  const bootstrap = require(bootstrapCorePath);
  const tracked = [];
  const drain = { track(value) { tracked.push(value); } };
  class FakeWorkflowRunner {
    constructor() {
      this.activeExecutions = { getPostExecutePromise: (id) => Promise.resolve(`finished:${id}`) };
    }
    async run() { return 'error-execution-1'; }
  }
  assert.equal(bootstrap.patchWorkflowRunnerForCliDrain(FakeWorkflowRunner, drain), true);
  const runner = new FakeWorkflowRunner();
  await runner.run({ executionMode: 'regular' });
  await runner.run({ executionMode: 'error' });
  assert.equal(tracked.length, 1);
  assert.equal(await tracked[0], 'finished:error-execution-1');
});

