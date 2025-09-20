# AI Improvement Log
- Issue: #92
- Title: AI: CRM TODOs discovered (50)
- Labels: ai, ai:crm, ai:docs, triage
- Planned: Planned by AI runner for issue #92: AI: CRM TODOs discovered (50)
- Timestamp: 2025-08-22T13:11:51.651Z

Notes:
AI detected TODO markers in CRM codebase. Consider converting into docs/tasks.

- comprehensive-crm-so/node_modules/js-yaml/dist/js-yaml.mjs:261:  // TODO: Add tag format check.
- comprehensive-crm-so/node_modules/js-yaml/dist/js-yaml.mjs:1749:        // TODO: rework to inline fn with no type cast?
- comprehensive-crm-so/node_modules/js-yaml/dist/js-yaml.js:267:    // TODO: Add tag format check.
- comprehensive-crm-so/node_modules/js-yaml/dist/js-yaml.js:1755:          // TODO: rework to inline fn with no type cast?
- comprehensive-crm-so/node_modules/js-yaml/lib/loader.js:659:        // TODO: rework to inline fn with no type cast?
- comprehensive-crm-so/node_modules/js-yaml/lib/type.js:47:  // TODO: Add tag format check.
- comprehensive-crm-so/node_modules/@jridgewell/gen-mapping/src/gen-mapping.ts:308:  // TODO: implement originalScopes/generatedRanges
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:13684:        // TODO: don't use slice
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:13790:          // TODO: don't use slice
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:18148:    // TODO(rbuckton): These aren't valid TypeNodes, but we treat them as such because of `isPartOfTypeNode`, which returns `true` for things that aren't `TypeNode`s.
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:19707:    // TODO: Should prefix `++` and `--` be moved to the `Update` precedence?
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:31220:                // TODO: GH#18217
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:31240:                // TODO: GH#18217
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:31315:              // TODO: GH#18217
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:32608:  return visitNode2(cbNode, node.expression) || // TODO: should we separate these branches out?
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:34648:        // TODO(rbuckton): JSDoc parameters don't have names (except `this`/`new`), should we manufacture an empty identifier?
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:58490:        !!(length(filter(getPropertiesOfType(typeToSerialize), isNamespaceMember)) || length(getSignaturesOfType(typeToSerialize, 0 /* Call */))) && !length(getSignaturesOfType(typeToSerialize, 1 /* Construct */)) && // TODO: could probably serialize as function + ns + class, now that that's OK
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:58580:                // TODO: https://github.com/microsoft/TypeScript/pull/32372#discussion_r328386357
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:66643:      // TODO(rbuckton): These aren't valid TypeNodes, but we treat them as such because of `isPartOfTypeNode`, which returns `true` for things that aren't `TypeNode`s.
- comprehensive-crm-so/node_modules/typescript/lib/typescript.js:106977:      // TODO: GH#18217