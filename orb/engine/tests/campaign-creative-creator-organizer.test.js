const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOrganizer, CREATOR_WORKFLOW_ID, ORGANIZER_ID } = require('../scripts/build-campaign-creative-creator-organizer');

test('Organizer builder produces a safe inactive subworkflow route to the operational creator entry', () => {
  const source = {
    id: ORGANIZER_ID,
    name: 'Other',
    active: false,
    nodes: [],
    connections: {},
    settings: { availableInMCP: false },
  };
  const workflow = buildOrganizer(source);
  assert.equal(workflow.id, ORGANIZER_ID);
  assert.equal(workflow.name, 'Campaign Creative Creator Organizer');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.length, 5);
  assert.equal(workflow.nodes.some((node) => node.credentials), false);
  const execute = workflow.nodes.find((node) => node.name === 'Execute Campaign Creative Creator');
  assert.equal(execute.parameters.workflowId.value, CREATOR_WORKFLOW_ID);
  assert.equal(execute.parameters.options.waitForSubWorkflow, true);
  const request = workflow.nodes.find((node) => node.name === 'Build CCG Operational Request');
  assert.match(request.parameters.jsCode, /organizer-mock-brand-logo-v1/);
  assert.match(request.parameters.jsCode, /approval_status: 'approved'/);
  assert.match(request.parameters.jsCode, /mock:\/\/approved-assets/);
  assert.match(request.parameters.jsCode, /max_jobs: defaultMaxJobs/);
  assert.equal(workflow.nodes.find((node) => node.name === 'Organizer Safe Defaults').parameters.assignments.assignments.find((assignment) => assignment.name === 'max_jobs').value, 4);
  assert.equal(workflow.connections['Build CCG Operational Request'].main[0][0].node, 'Execute Campaign Creative Creator');
  assert.equal(workflow.meta.publish_allowed, false);
  assert.equal(workflow.meta.no_public_webhook, true);
});

test('Organizer builder writes a reproducible candidate without legacy provider nodes', () => {
  const source = { id: ORGANIZER_ID, name: 'Other', active: false, nodes: [], connections: {}, settings: {} };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-organizer-test-'));
  const outputPath = path.join(tempDir, 'organizer.json');
  const workflow = buildOrganizer(source, { creatorWorkflowId: '9j7WMFTNVNYmNZHC' });
  fs.writeFileSync(outputPath, JSON.stringify(workflow));
  const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(persisted.nodes.find((node) => node.name === 'Execute Campaign Creative Creator').parameters.workflowId.value, '9j7WMFTNVNYmNZHC');
  assert.equal(persisted.nodes.some((node) => /googleDrive|httpRequest|langchain/i.test(node.type)), false);
});
