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

test("single-writer graph detects indirect Cloudflare API, Terraform and Pulumi mutations", () => {
  const mutationFiles = [
    ".github/workflows/demo.yml",
    ".github/actions/demo/action.yml",
    ".github/scripts/demo-deploy.mjs",
  ];
  const mutationContents = {
    ".github/workflows/demo.yml": "uses: ./.github/actions/demo",
    ".github/actions/demo/action.yml": "run: node .github/scripts/demo-deploy.mjs",
    ".github/scripts/demo-deploy.mjs": [
      "await fetch('https://api.cloudflare.com/client/v4/accounts/demo/workers', {",
      "  method: 'POST',",
      "});",
      "terraform -chdir=ops/cloudflare apply -auto-approve",
      "pulumi up --yes",
    ].join("\n"),
  };
  const graph = traceMutationGraph({ sourcePath: ".github/workflows/demo.yml", files: mutationFiles, readFile: (file) => mutationContents[file] });
  const evidence = mutationEvidence(graph);
  assert.ok(evidence.some((item) => item.line.includes("Cloudflare API")));
  assert.ok(evidence.some((item) => item.line.includes("terraform")));
  assert.ok(evidence.some((item) => item.line.includes("pulumi")));
});

test("Terraform plan and Pulumi preview remain read-only", () => {
  const graph = traceMutationGraph({
    sourcePath: ".github/scripts/demo-read.mjs",
    files: [".github/scripts/demo-read.mjs"],
    readFile: () => "terraform plan\npulumi preview\nfetch('https://api.cloudflare.com/client/v4/accounts/demo')",
  });
  assert.deepEqual(mutationEvidence(graph), []);
});

test("a Cloudflare read is not tainted by an unrelated external POST", () => {
  const graph = traceMutationGraph({
    sourcePath: ".github/scripts/demo-read.mjs",
    files: [".github/scripts/demo-read.mjs"],
    readFile: () => [
      "await fetch('https://api.cloudflare.com/client/v4/accounts/demo', { headers: auth });",
      "await fetch('https://synthetic.example.test/probe', { method: 'POST' });",
    ].join("\n"),
  });
  assert.deepEqual(mutationEvidence(graph), []);
});

test("a local Cloudflare wrapper is classified when a caller supplies a mutating method", () => {
  const graph = traceMutationGraph({
    sourcePath: ".github/scripts/demo-deploy.mjs",
    files: [".github/scripts/demo-deploy.mjs"],
    readFile: () => [
      "const cloudflare = async (pathname, init = {}) => fetch(`https://api.cloudflare.com/client/v4${pathname}`, { ...init });",
      "await cloudflare('/accounts/demo/pages/projects/demo/deployments/id/rollback', { method: 'POST' });",
    ].join("\n"),
  });
  assert.ok(mutationEvidence(graph).some((item) => item.line.includes("Cloudflare API")));
});
