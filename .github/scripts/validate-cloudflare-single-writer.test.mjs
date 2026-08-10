import test from "node:test";
import assert from "node:assert/strict";
import { mutationEvidence, traceMutationGraph } from "./validate-cloudflare-single-writer.mjs";

const files = [
  ".github/workflows/demo.yml",
  ".github/actions/demo/action.yml",
  ".github/scripts/demo-deploy.mjs",
  ".github/scripts/demo-read.mjs",
];
const contents = {
  ".github/workflows/demo.yml": "jobs:\n  deploy:\n    steps:\n      - uses: ./.github/actions/demo\n      - run: node .github/scripts/demo-read.mjs\n",
  ".github/actions/demo/action.yml": "name: demo\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: node .github/scripts/demo-deploy.mjs\n",
  ".github/scripts/demo-deploy.mjs": "await execa('wrangler', ['versions', 'deploy', 'candidate@100%']);\n",
  ".github/scripts/demo-read.mjs": "await execa('wrangler', ['deployments', 'status']);\n",
};
const readFile = (file) => contents[file];

test("single-writer graph follows local actions and scripts to find a mutation", () => {
  const graph = traceMutationGraph({ sourcePath: ".github/workflows/demo.yml", files, readFile });
  assert.deepEqual(graph.missing, []);
  assert.deepEqual(graph.files, [...files].sort());
  assert.equal(mutationEvidence(graph).length, 1);
  assert.match(mutationEvidence(graph)[0].file, /demo-deploy\.mjs$/);
});

test("read-only Wrangler status is not classified as a mutation", () => {
  const graph = traceMutationGraph({ sourcePath: ".github/scripts/demo-read.mjs", files, readFile });
  assert.deepEqual(mutationEvidence(graph), []);
});

test("local and dry-run operations remain non-mutating", () => {
  const local = traceMutationGraph({
    sourcePath: ".github/scripts/demo-read.mjs",
    files: [".github/scripts/demo-read.mjs"],
    readFile: () => "wrangler d1 migrations apply demo --local\nwrangler deploy --dry-run",
  });
  assert.deepEqual(mutationEvidence(local), []);
});
