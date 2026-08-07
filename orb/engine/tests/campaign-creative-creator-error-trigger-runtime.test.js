'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const engineRoot = path.resolve(__dirname, '..');
const preloadPath = path.join(engineRoot, 'scripts', 'preload-n8n-error-workflow-bootstrap.js');
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
    `require(${JSON.stringify(runnerPath)});`,
    `const { WorkflowExecutionService } = require(${JSON.stringify(servicePath)});`,
    "const dependencies = Reflect.getMetadata('design:paramtypes', WorkflowExecutionService) || [];",
    'process.stdout.write(String(typeof dependencies[6]));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--require', preloadPath, '-e', probe], {
    encoding: 'utf8',
    env: { ...process.env, N8N_GLOBAL_DIR: n8nRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});
