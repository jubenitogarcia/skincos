'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('../scripts/lib/meta-ads-publish-execution-semantics');
const { CRM_TOOL_NAME, CRM_URL, transform } = require('../scripts/prepare-meta-ads-publish-crm-catalog');
const { transform: patchVideoUploadReplay } = require('../scripts/patch-meta-ads-video-transfer-replay');
const { CODE_SOURCES } = require('../scripts/lib/meta-ads-publish-code-sources');

test('tracks every live Meta Ads Publish Code node in one shared source map', () => {
  assert.equal(Object.keys(CODE_SOURCES).length, 49);
  assert.equal(CODE_SOURCES['Build Jobs'], 'build-jobs.js');
  assert.equal(CODE_SOURCES['Validate Visual Grouping'], 'validate-visual-grouping.js');
  assert.equal(CODE_SOURCES['Prepare CRM Offer Context Requests'], 'prepare-crm-offer-context-requests.js');
  assert.equal(CODE_SOURCES['Attach CRM Offer Context'], 'attach-crm-offer-context.js');
});

test('Responses API uses the n8n 1.3 default when the stored parameter is absent', () => {
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: {} }), true);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: { responsesApiEnabled: false } }), false);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.2, parameters: {} }), false);
});

test('execution version follows current for inactive workflows and published version for active workflows', () => {
  const current = { version_id: 'current' };
  const history = [{ version_id: 'published' }];
  assert.equal(executionSummaryForWorkflow({ active: false, activeVersionId: 'published' }, current, history), current);
  assert.deepEqual(executionSummaryForWorkflow({ active: true, activeVersionId: 'published' }, current, history), history[0]);
});

test('version alignment treats an inactive workflow current definition as authoritative', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'inspect-meta-ads-publish-version-alignment.js'),
    'utf8',
  );
  assert.match(source, /row\.active === true/);
  assert.match(source, /executionSummary\.version_id === row\.versionId/);
});

test('manual execution retention is reported without assuming execution data exists', () => {
  assert.equal(manualExecutionAuditState({ saveManualExecutions: true }), 'persisted');
  assert.equal(manualExecutionAuditState({ saveManualExecutions: false }), 'not_persisted');
  assert.equal(manualExecutionAuditState({}), 'not_persisted');
});

test('replaces the legacy Sheets tool with the authenticated CRM offer-context tool', () => {
  const schema = {
    properties: {
      analysis: {
        required: ['spreadsheetPricing'],
        properties: { spreadsheetPricing: { properties: { source: { enum: ['spreadsheet', 'none'] } } } },
      },
    },
  };
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [
      { id: 'legacy', name: 'Knowledge', type: 'n8n-nodes-base.googleSheetsTool', parameters: {} },
      {
        name: 'Livia',
        type: '@n8n/n8n-nodes-langchain.agent',
        parameters: {
          text: 'Em `spreadsheetPricing`, use dados da planilha apenas se forem realmente consultados.\ndestination_group: $json.destination_group,',
          options: { systemMessage: '- Se preço não estiver claro na mídia, consulte "Knowledge" no máximo 1 vez.\n- Se faltar contexto de marca, consulte "Documents" no máximo 1 vez.\n- Use a planilha apenas quando necessário e apenas para complementar informação ausente da mídia.\n- `spreadsheetPricing` deve refletir apenas o que vier da planilha, quando ela for consultada.' },
        },
      },
      { name: 'OpenAI Chat Model (Agent)', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: { options: { textFormat: { textOptions: { schema: JSON.stringify(schema) } } } } },
    ],
    connections: { Knowledge: { ai_tool: [[{ node: 'Livia', type: 'ai_tool', index: 0 }]] } },
  };
  const candidate = transform(workflow, { credentialId: 'credential-id', credentialName: 'CRM Meta Ads Offer Context' });
  assert.equal(candidate.nodes.some((node) => node.type === 'n8n-nodes-base.googleSheetsTool'), false);
  const crm = candidate.nodes.find((node) => node.name === CRM_TOOL_NAME);
  assert.equal(crm.parameters.url, CRM_URL);
  assert.equal(crm.credentials.httpBearerAuth.id, 'credential-id');
  assert.deepEqual(candidate.connections[CRM_TOOL_NAME].ai_tool[0][0], { node: 'Livia', type: 'ai_tool', index: 0 });
  const updatedSchema = JSON.parse(candidate.nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)').parameters.options.textFormat.textOptions.schema);
  assert.equal(updatedSchema.properties.analysis.properties.spreadsheetPricing, undefined);
  assert.deepEqual(updatedSchema.properties.analysis.properties.crmPricing.properties.source.enum, ['crm', 'none']);
});

test('preflight loads workflow connections before validating the CRM tool edge', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'validate-meta-ads-publish-preflight.js'),
    'utf8',
  );
  assert.match(source, /SELECT active, nodes, connections, settings,/);
  assert.match(source, /gateway_contract_revision_gate_missing/);
  assert.doesNotMatch(source, /new RegExp\(/);
});

test('gateway parameters reject a Token Vault contract revision mismatch before publication', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish', 'build-meta-api-params-from-vault.js'),
    'utf8',
  );
  assert.match(source, /const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v21_video_916_global_copy_calibration_terminal'/);
  assert.match(source, /gatewayContractRevision !== WORKFLOW_CONTRACT_REVISION/);
});

test('video-only source sends an auto-crop request and keeps five global copy variants', () => {
  const engineRoot = path.join(__dirname, '..');
  const buildJobs = fs.readFileSync(
    path.join(engineRoot, 'workflow-src', 'meta-ads-publish', 'build-jobs.js'),
    'utf8',
  );
  const validator = fs.readFileSync(
    path.join(engineRoot, 'workflow-src', 'meta-ads-publish', 'validate-meta-creative-payload.js'),
    'utf8',
  );
  const workflow = JSON.parse(fs.readFileSync(
    path.join(engineRoot, 'workflows', 'meta-ads-publish.current.json'),
    'utf8',
  ));
  const embeddedBuildJobs = workflow.nodes.find((node) => node.name === 'Build Jobs')?.parameters?.jsCode;

  assert.match(buildJobs, /creativeFeaturesSpec\.video_auto_crop = \{ enroll_status: 'OPT_IN' \}/);
  assert.match(buildJobs, /const videoOnlyUsesGlobalTextVariants = mediaMode === 'video_only';/);
  assert.match(buildJobs, /videoOnlyPlacementRules[\s\S]*?video_label: videoLabel,[\s\S]*?priority: 1,/);
  assert.doesNotMatch(buildJobs, /body_label: videoOnlyBodyLabels/);
  assert.match(validator, /video_only_global_bodies_invalid/);
  assert.match(validator, /video_only_rule_body_label_forbidden/);
  assert.equal(String(embeddedBuildJobs).trim(), buildJobs.trim());
});

test('creative fallbacks fail closed when Meta rejects the mandatory video auto-crop opt-in', () => {
  const engineRoot = path.join(__dirname, '..');
  for (const filename of ['prepare-creative-fallback-1.js', 'prepare-creative-fallback-2.js']) {
    const source = fs.readFileSync(
      path.join(engineRoot, 'workflow-src', 'meta-ads-publish', filename),
      'utf8',
    );
    assert.throws(
      () => vm.runInNewContext(`(() => {\n${source}\n})()`, {
        $input: {
          all: () => [{
            json: {
              ok: false,
              detail: { error: 'video_auto_crop is unsupported for this creative' },
              job_key: 'synthetic-video-only',
              creativePayload: {
                degrees_of_freedom_spec: {
                  creative_features_spec: { video_auto_crop: { enroll_status: 'OPT_IN' } },
                },
              },
            },
          }],
        },
      }),
      /video_auto_crop; o workflow recusa fallback para formato Original/,
    );
  }
});

test('paused calibration batches stop before Drive finalization and cannot mix with commercial jobs', () => {
  const engineRoot = path.join(__dirname, '..');
  const stageSource = fs.readFileSync(
    path.join(engineRoot, 'workflow-src', 'meta-ads-publish', 'build-stage-batch.js'),
    'utf8',
  );
  const runStage = (items) => vm.runInNewContext(`(() => {\n${stageSource}\n})()`, {
    $input: { all: () => items },
  });
  const calibration = {
    json: {
      run_id: 'run-synthetic-calibration',
      creative_id: '10000000001',
      action: 'create_new',
      destination_adset_id: '20000000001',
      destination_group: 'synthetic',
      creative_group_key: 'synthetic-video',
      media_variant: 'video_only',
      token_id: 'facebook_synthetic',
      account_id: '30000000001',
      api_version: 'v25.0',
      desired_final_status: 'PAUSED',
      calibration_mode: true,
      calibration_marker: '[TEST-VIDEO-ONLY]',
      adPayload: {
        name: '[TEST-VIDEO-ONLY] Synthetic 9:16 calibration',
        status: 'PAUSED',
        adset_id: '20000000001',
      },
      asset_ids: { vertical_video: 'drive-synthetic' },
      asset_names: { vertical_video: 'synthetic.mp4' },
    },
  };
  const batch = runStage([calibration])[0].json;
  assert.equal(batch.publication_mode, 'calibration_paused');
  assert.equal(batch.gateway_request.jobs[0].publication_mode, 'calibration_paused');
  assert.equal(batch.gateway_request.jobs[0].desired_status, 'PAUSED');

  const commercial = structuredClone(calibration);
  commercial.json.destination_adset_id = '20000000002';
  commercial.json.creative_group_key = 'synthetic-commercial';
  commercial.json.desired_final_status = 'ACTIVE';
  commercial.json.calibration_mode = false;
  commercial.json.calibration_marker = '';
  commercial.json.adPayload = {
    name: 'Synthetic commercial publication',
    status: 'ACTIVE',
    adset_id: '20000000002',
  };
  assert.throws(
    () => runStage([calibration, commercial]),
    /lote misto de calibracao e publicacao comercial/,
  );

  const finalizationSource = fs.readFileSync(
    path.join(engineRoot, 'workflow-src', 'meta-ads-publish', 'build-drive-finalization.js'),
    'utf8',
  );
  const finalization = vm.runInNewContext(`(() => {\n${finalizationSource}\n})()`, {
    $input: {
      first: () => ({ json: {
        ok: true,
        operation: { status: 'completed', result: { status: 'calibration_paused', jobs: batch.gateway_request.jobs } },
      } }),
    },
    $items: () => { throw new Error('Drive finalization must not be reached for calibration.'); },
  });
  assert.equal(Array.isArray(finalization), true);
  assert.equal(finalization.length, 0);

  assert.throws(
    () => vm.runInNewContext(`(() => {\n${finalizationSource}\n})()`, {
      $input: { first: () => ({ json: {
        resume_drive_only: true,
        run: { id: 'run-synthetic-calibration', summary: { publication_mode: 'calibration_paused', jobs: batch.gateway_request.jobs } },
      } }) },
    }),
    /recusou retomada sem contrato comercial explicito/,
  );

  const commercialJobs = batch.gateway_request.jobs.map((job) => ({
    ...job,
    desired_status: 'ACTIVE',
    publication_mode: 'commercial',
    calibration_marker: '',
  }));
  const commercialResume = vm.runInNewContext(`(() => {\n${finalizationSource}\n})()`, {
    $input: { first: () => ({ json: {
      resume_drive_only: true,
      run: { id: 'run-synthetic-commercial', summary: { publication_mode: 'commercial', jobs: commercialJobs } },
    } }) },
    $execution: { id: 'execution-synthetic-commercial' },
  });
  assert.equal(Array.isArray(commercialResume), true);
  assert.equal(commercialResume.length, 1);

  const restoreSource = fs.readFileSync(
    path.join(engineRoot, 'workflow-src', 'meta-ads-publish', 'restore-publish-groups.js'),
    'utf8',
  );
  assert.throws(
    () => vm.runInNewContext(`(() => {\n${restoreSource}\n})()`, {
      $input: { first: () => ({ json: { ok: true, run: { id: 'run-synthetic-calibration', status: 'calibration_paused' } } }) },
      $items: () => [],
    }),
    /ja terminou com status calibration_paused/,
  );
  assert.throws(
    () => vm.runInNewContext(`(() => {\n${restoreSource}\n})()`, {
      $input: { first: () => ({ json: {
        ok: true,
        run: { id: 'run-ambiguous-drive', status: 'meta_completed_drive_pending', summary: { jobs: commercialJobs } },
      } }) },
      $items: () => [],
    }),
    /pendente no Drive sem contrato comercial explicito/,
  );
});

test('video upload replay key includes normalized bytes and rejects the legacy v4 key', () => {
  const workflow = {
    id: 'eFJhFg79lyaycjlm',
    active: false,
    nodes: [{
      name: 'Prepare Video Upload Starts',
      type: 'n8n-nodes-base.code',
      parameters: {
        jsCode: [
          "const normalizedFile = text(processing.normalized_file || video.normalized_file);",
          "    if (!runId || !fileSize || !normalizedFile) throw new Error(`Video ${video.id} sem run_id, tamanho ou caminho normalizado.`);",
          "checksum_sha256: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
          "operation_key: `video-start:v4:${stableHash([runId, accountId, tokenId, apiVersion, video.id, sourceFingerprint, VIDEO_NORMALIZATION_CONTRACT_REVISION].map(text).join('|'))}`",
          "file_checksum: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
        ].join('\n'),
      },
    }],
  };
  const candidate = patchVideoUploadReplay(workflow);
  const code = candidate.nodes[0].parameters.jsCode;
  assert.match(code, /video-start:v5:/);
  assert.match(code, /checksumSha256, fileSize/);
  assert.match(code, /checksum SHA-256 valido/);
  assert.doesNotMatch(code, /video-start:v4:/);
});
