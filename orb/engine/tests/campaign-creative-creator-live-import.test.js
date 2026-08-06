const assert = require('node:assert/strict');
const test = require('node:test');

const { prepareLiveImport } = require('../scripts/prepare-campaign-creative-creator-live-import');

test('live import adds only runtime OpenAI credential references', () => {
  const source = {
    id: 'workflow-under-test',
    nodes: [
      {
        name: 'Model A',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        parameters: { model: 'gpt-test' },
      },
      {
        name: 'Code',
        type: 'n8n-nodes-base.code',
        parameters: { jsCode: 'return [];' },
      },
    ],
  };

  const prepared = prepareLiveImport(source, {
    credentialId: 'runtime-openai-credential-id',
    credentialName: 'Runtime OpenAI account',
  });

  assert.equal(prepared.patchedNodes, 1);
  assert.deepEqual(prepared.workflow.nodes[0].credentials, {
    openAiApi: {
      id: 'runtime-openai-credential-id',
      name: 'Runtime OpenAI account',
    },
  });
  assert.equal(source.nodes[0].credentials, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared.workflow.nodes[0].credentials.openAiApi, 'data'), false);
});

test('live import rejects an export with no OpenAI model nodes', () => {
  assert.throws(() => prepareLiveImport({ nodes: [] }, {
    credentialId: 'runtime-openai-credential-id',
    credentialName: 'Runtime OpenAI account',
  }), /No OpenAI chat model nodes/);
});
