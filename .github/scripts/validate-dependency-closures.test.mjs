import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDependencyClosures } from "./validate-dependency-closures.mjs";

function fixture(overrides = {}) {
  const files = ["src/entry.mjs", "src/inside.mjs", "outside.mjs"];
  const contents = {
    "src/entry.mjs": 'import "./inside.mjs"; import "../outside.mjs";',
    "src/inside.mjs": "export const ok = true;",
    "outside.mjs": "export const outside = true;",
  };
  const policy = {
    sharedInputs: [],
    releaseClosures: {
      demo: { patterns: ["src/**"], sharedInputs: false },
    },
    ...overrides,
  };
  return { policy, files, readFile: (file) => contents[file] };
}

test("dependency closure follows local imports and rejects an undeclared edge", () => {
  const result = validateDependencyClosures({ ...fixture(), modules: ["demo"] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /src\/entry\.mjs -> outside\.mjs/);
});

test("dependency closure exception is explicit and scoped to the source edge", () => {
  const result = validateDependencyClosures({
    ...fixture({ closureExceptions: [{ module: "demo", sourcePattern: "src/entry.mjs", dependencyPattern: "outside.mjs" }] }),
    modules: ["demo"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].dependencyClosureDigest.length, 64);
});

test("empty or undeclared closure fails closed", () => {
  const empty = validateDependencyClosures({
    ...fixture({ releaseClosures: { demo: { patterns: [], sharedInputs: false } } }),
    modules: ["demo"],
  });
  assert.match(empty.errors[0], /closure for demo is empty/);

  const missing = validateDependencyClosures({
    ...fixture({ releaseClosures: {} }),
    modules: ["demo"],
  });
  assert.match(missing.errors[0], /closure is not declared for demo/);
});

test("glob matching stays bounded for recursive and segment wildcards", () => {
  const result = validateDependencyClosures({
    ...fixture({
      releaseClosures: { demo: { patterns: ["src/**", "src/entry.???"], sharedInputs: false } },
      closureExceptions: [{ module: "demo", sourcePattern: "src/entry.???", dependencyPattern: "outside.mjs" }],
    }),
    modules: ["demo"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].selectedFileCount, 2);
});

test("dependency closure follows reusable local actions and shared helpers", () => {
  const files = [
    ".github/workflows/demo.yml",
    ".github/actions/demo/action.yml",
    ".github/scripts/demo.mjs",
    "shared/common.mjs",
    "docs/independent.md",
  ];
  const contents = {
    ".github/workflows/demo.yml": 'uses: "./.github/actions/demo"',
    ".github/actions/demo/action.yml": "run: node .github/scripts/demo.mjs",
    ".github/scripts/demo.mjs": 'import "../../shared/common.mjs";',
    "shared/common.mjs": "export const ok = true;",
    "docs/independent.md": "documentation only",
  };
  const result = validateDependencyClosures({
    policy: {
      sharedInputs: [],
      releaseClosures: { demo: { patterns: [".github/**", "shared/**"], sharedInputs: false } },
    },
    files,
    readFile: (file) => contents[file],
    modules: ["demo"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].reachableFileCount, 4);
});

test("unrelated documentation stays outside the observed dependency closure", () => {
  const base = fixture();
  const first = validateDependencyClosures({ ...base, modules: ["demo"] });
  const second = validateDependencyClosures({
    ...base,
    files: [...base.files, "docs/independent.md"],
    readFile: (file) => file === "docs/independent.md" ? "changed docs" : base.readFile(file),
    modules: ["demo"],
  });
  assert.deepEqual(second.errors, first.errors);
  assert.equal(second.reports[0].dependencyClosureDigest, first.reports[0].dependencyClosureDigest);
  assert.equal(second.reports[0].reachableFileCount, first.reports[0].reachableFileCount);
});

test("dependency closure resolves npm scripts to their package helpers", () => {
  const files = [".github/workflows/demo.yml", "package.json", ".github/scripts/demo.mjs", "shared/common.mjs"];
  const contents = {
    ".github/workflows/demo.yml": "run: npm run demo:check",
    "package.json": JSON.stringify({ scripts: { "demo:check": "node ./.github/scripts/demo.mjs" } }),
    ".github/scripts/demo.mjs": 'import "../../shared/common.mjs";',
    "shared/common.mjs": "export const ok = true;",
  };
  const result = validateDependencyClosures({
    policy: { sharedInputs: [], releaseClosures: { demo: { patterns: [".github/**", "shared/**", "package.json"], sharedInputs: false } } },
    files,
    readFile: (file) => contents[file],
    modules: ["demo"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].reachableFileCount, 4);
});

test("promotion source-ref validation remains in every shared release closure", () => {
  const policy = JSON.parse(readFileSync(new URL("../../ops/governance/global-concurrency-policy.json", import.meta.url), "utf8"));
  assert.ok(policy.sharedInputs.includes(".github/scripts/validate-promotion-source-ref.mjs"));
});
