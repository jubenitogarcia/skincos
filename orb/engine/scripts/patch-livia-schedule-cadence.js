'use strict';

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const SCHEDULE_NODE = 'Schedule Trigger';
const MINUTES_INTERVAL = 15;

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const candidate = structuredClone(workflow);
  const schedule = (candidate.nodes || []).find((node) => node?.name === SCHEDULE_NODE);
  if (!schedule || schedule.type !== 'n8n-nodes-base.scheduleTrigger') {
    throw new Error('Schedule Trigger must be the n8n Schedule Trigger node.');
  }

  schedule.parameters ||= {};
  schedule.parameters.rule = {
    ...(schedule.parameters.rule || {}),
    interval: [{ field: 'minutes', minutesInterval: MINUTES_INTERVAL }],
  };

  return candidate;
}

module.exports = { MINUTES_INTERVAL, SCHEDULE_NODE, patchWorkflow };
