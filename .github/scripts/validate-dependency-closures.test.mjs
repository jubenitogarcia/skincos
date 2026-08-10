import test from "node:test";
import assert from "node:assert/strict";
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
