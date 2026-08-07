'use strict';

const fs = require('fs');
const path = require('path');

const CCG_RECOVERY_NODE = 'CCG-00 Capture Recovery Context';
const AWAIT_ERROR_WORKFLOW_ENV = 'SKINCOS_AWAIT_ERROR_WORKFLOW';
const AWAIT_ERROR_WORKFLOW_TIMEOUT_ENV = 'SKINCOS_AWAIT_ERROR_WORKFLOW_TIMEOUT_MS';

function text(value, maxLength = 256) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function sanitizeRecoveryContext(value) {
  const context = object(value);
  const policy = object(context.recovery_policy);
  const mode = text(context.mode, 32).toUpperCase();
  const tier = text(context.production_tier, 32).toUpperCase();
  const moduleName = text(context.module, 32).toUpperCase();
  const checkpointModule = text(context.checkpoint_module, 32).toUpperCase();
  if (!text(context.run_id) || !text(context.idempotency_key) || !text(context.request_hash)) return null;
  if (!['DRY_RUN', 'LIVE', 'UNKNOWN'].includes(mode)) return null;
  if (!['FAST', 'STANDARD', 'PREMIUM'].includes(tier)) return null;
  if (!/^CCG-(?:00|10|20|30|40|50|60|70|80|90)$/.test(moduleName)) return null;
  if (!/^CCG-(?:00|10|20|30|40|50|60|70|80|90)$/.test(checkpointModule)) return null;
  return {
    schema_version: text(context.schema_version, 32) || '1.0.0',
    run_id: text(context.run_id),
    production_id: text(context.production_id),
    content_id: text(context.content_id),
    campaign_id: text(context.campaign_id),
    request_hash: text(context.request_hash),
    idempotency_key: text(context.idempotency_key),
    production_tier: tier,
    mode,
    module: moduleName,
    checkpoint_module: checkpointModule,
    current_attempt: boundedInteger(context.current_attempt, 1, 1, 12),
    max_attempts: boundedInteger(context.max_attempts, 3, 1, 12),
    recovery_policy: {
      dispatch_enabled: policy.dispatch_enabled === true,
      allow_execution_retry: policy.allow_execution_retry !== false,
      allow_checkpoint_resume: policy.allow_checkpoint_resume !== false,
      maximum_backoff_seconds: boundedInteger(policy.maximum_backoff_seconds, 900, 30, 3600),
    },
  };
}

function captureContextFromRunData(fullRunData) {
  const runs = fullRunData?.data?.resultData?.runData?.[CCG_RECOVERY_NODE];
  if (!Array.isArray(runs)) return null;
  for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
    const output = runs[runIndex]?.data?.main;
    if (!Array.isArray(output)) continue;
    for (const branch of output) {
      if (!Array.isArray(branch)) continue;
      for (const item of branch) {
        const context = sanitizeRecoveryContext(item?.json?.ccg_recovery_context);
        if (context) return context;
      }
    }
  }
  return null;
}

function attachCcgRecoveryContext(fullRunData) {
  try {
    const context = captureContextFromRunData(fullRunData);
    const error = fullRunData?.data?.resultData?.error;
    if (!context || !error || typeof error !== 'object') return false;
    Object.defineProperty(error, 'ccg_recovery_context', {
      value: context,
      enumerable: true,
      configurable: true,
      writable: false,
    });
    return true;
  } catch {
    // Capturing CCG lineage must never replace the original error handling path.
    return false;
  }
}

function resolveN8nRoot() {
  const configured = text(process.env.N8N_GLOBAL_DIR, 1024);
  const root = configured || '/usr/local/lib/node_modules/n8n';
  const servicePath = path.join(root, 'dist', 'workflows', 'workflow-execution.service.js');
  const runnerPath = path.join(root, 'dist', 'workflow-runner.js');
  const errorWorkflowPath = path.join(root, 'dist', 'execution-lifecycle', 'execute-error-workflow.js');
  const diPath = path.join(root, 'node_modules', '@n8n', 'di');
  if (!fs.existsSync(servicePath) || !fs.existsSync(runnerPath) || !fs.existsSync(errorWorkflowPath) || !fs.existsSync(diPath)) {
    throw new Error('n8n error-workflow bootstrap could not resolve the installed runtime modules');
  }
  return { servicePath, runnerPath, errorWorkflowPath, diPath };
}

function repairWorkflowExecutionMetadata(WorkflowExecutionService, WorkflowRunner) {
  const dependencies = Reflect.getMetadata('design:paramtypes', WorkflowExecutionService);
  if (!Array.isArray(dependencies) || dependencies.length < 7) {
    throw new Error('n8n error-workflow bootstrap could not inspect WorkflowExecutionService dependencies');
  }
  if (typeof WorkflowRunner !== 'function') {
    throw new Error('n8n error-workflow bootstrap could not load WorkflowRunner');
  }
  if (dependencies[6] === WorkflowRunner) return false;
  // n8n 2.8.3 evaluates this constructor metadata while workflow-runner is
  // still inside the error-workflow cycle. The sixth dependency is therefore
  // permanently recorded as undefined, even once the module cache settles.
  const repaired = [...dependencies];
  repaired[6] = WorkflowRunner;
  Reflect.defineMetadata('design:paramtypes', repaired, WorkflowExecutionService);
  return true;
}

function createCliErrorWorkflowDrain(processRef = process, options = {}) {
  if (text(processRef?.env?.[AWAIT_ERROR_WORKFLOW_ENV], 16) !== '1') return null;
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? processRef.env?.[AWAIT_ERROR_WORKFLOW_TIMEOUT_ENV],
    30000,
    1000,
    120000,
  );
  const discoveryMs = Math.min(1000, timeoutMs);
  const originalExit = processRef.exit.bind(processRef);
  const pending = new Set();
  let observed = false;
  let exitRequested = false;
  let exitCode = 0;
  let completed = false;
  const keepAlive = setInterval(() => {}, 250);
  let discoveryTimer;
  let timeoutTimer;

  function finish() {
    if (completed) return;
    completed = true;
    clearInterval(keepAlive);
    clearTimeout(discoveryTimer);
    clearTimeout(timeoutTimer);
    originalExit(exitCode);
  }

  function maybeFinish() {
    if (exitRequested && observed && pending.size === 0) finish();
  }

  timeoutTimer = setTimeout(finish, timeoutMs);
  processRef.exit = function exitAfterCcgErrorWorkflow(code = 0) {
    exitRequested = true;
    exitCode = Number.isInteger(code) ? code : 1;
    if (observed) {
      maybeFinish();
      return;
    }
    discoveryTimer = setTimeout(() => {
      if (!observed) finish();
    }, discoveryMs);
  };

  return {
    track(value) {
      observed = true;
      clearTimeout(discoveryTimer);
      const promise = Promise.resolve(value).catch(() => undefined);
      pending.add(promise);
      promise.finally(() => {
        pending.delete(promise);
        maybeFinish();
      });
      return promise;
    },
    dispose() {
      if (completed) return;
      completed = true;
      clearInterval(keepAlive);
      clearTimeout(discoveryTimer);
      clearTimeout(timeoutTimer);
      processRef.exit = originalExit;
    },
  };
}

function patchWorkflowRunnerForCliDrain(WorkflowRunner, drain) {
  if (!drain) return false;
  if (!WorkflowRunner?.prototype || typeof WorkflowRunner.prototype.run !== 'function') {
    throw new Error('n8n error-workflow bootstrap could not inspect WorkflowRunner');
  }
  if (WorkflowRunner.prototype.__skincosCcgCliDrain === true) return false;
  const originalRun = WorkflowRunner.prototype.run;
  Object.defineProperty(WorkflowRunner.prototype, '__skincosCcgCliDrain', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  WorkflowRunner.prototype.run = async function runWithCcgCliDrain(data, ...args) {
    const executionId = await originalRun.call(this, data, ...args);
    if (data?.executionMode === 'error') {
      try {
        drain.track(this.activeExecutions.getPostExecutePromise(executionId));
      } catch {
        // The drain is a smoke-only CLI aid. It must never change workflow execution.
      }
    }
    return executionId;
  };
  return true;
}

function patchContainerGet(Container, WorkflowExecutionService, loadWorkflowRunner) {
  if (!Container || typeof Container.get !== 'function') {
    throw new Error('n8n error-workflow bootstrap could not inspect the dependency container');
  }
  if (typeof loadWorkflowRunner !== 'function') {
    throw new Error('n8n error-workflow bootstrap requires a WorkflowRunner loader');
  }
  if (Container.__skincosCcgWorkflowExecutionRepair === true) return false;

  // n8n's CLI lifecycle may load a second set of decorators after this preload
  // returns. Repair again at the only resolution point that matters rather than
  // relying on an earlier metadata snapshot to remain intact.
  const originalGet = Container.get;
  Object.defineProperty(Container, '__skincosCcgWorkflowExecutionRepair', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Container.get = function getWithCcgWorkflowExecutionRepair(token, ...args) {
    if (token === WorkflowExecutionService) {
      repairWorkflowExecutionMetadata(WorkflowExecutionService, loadWorkflowRunner());
    }
    return originalGet.call(this, token, ...args);
  };
  return true;
}

function bootstrap() {
  const { servicePath, runnerPath, errorWorkflowPath, diPath } = resolveN8nRoot();
  // This runs before WorkflowRunner. n8n 2.8.3 otherwise records an undefined
  // constructor parameter during its CommonJS cycle through error workflows.
  const { WorkflowExecutionService } = require(servicePath);
  if (typeof WorkflowExecutionService !== 'function') {
    throw new Error('n8n error-workflow bootstrap could not load WorkflowExecutionService');
  }
  const { WorkflowRunner } = require(runnerPath);
  repairWorkflowExecutionMetadata(WorkflowExecutionService, WorkflowRunner);
  patchWorkflowRunnerForCliDrain(WorkflowRunner, createCliErrorWorkflowDrain());
  const { Container } = require(diPath);
  patchContainerGet(Container, WorkflowExecutionService, () => require(runnerPath).WorkflowRunner);
  const errorWorkflowModule = require(errorWorkflowPath);
  const original = errorWorkflowModule.executeErrorWorkflow;
  if (typeof original !== 'function') {
    throw new Error('n8n error-workflow bootstrap could not load executeErrorWorkflow');
  }
  if (errorWorkflowModule.__skincosCcgRecoveryBootstrap === true) return;
  Object.defineProperty(errorWorkflowModule, '__skincosCcgRecoveryBootstrap', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  errorWorkflowModule.executeErrorWorkflow = function executeErrorWorkflowWithCcgRecovery(workflowData, fullRunData, ...rest) {
    attachCcgRecoveryContext(fullRunData);
    return original.call(this, workflowData, fullRunData, ...rest);
  };
}

module.exports = {
  attachCcgRecoveryContext,
  bootstrap,
  captureContextFromRunData,
  createCliErrorWorkflowDrain,
  patchContainerGet,
  patchWorkflowRunnerForCliDrain,
  repairWorkflowExecutionMetadata,
  sanitizeRecoveryContext,
};
