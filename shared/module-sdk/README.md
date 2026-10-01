# Skincos module SDK

`shared/module-sdk` is the only UI integration boundary between externally
published product surfaces and an extracted product module.  A module exposes
metadata, authorization requirements and a lazy view through this contract; it
never imports another product's internals.

The concrete TypeScript package is created when a module is extracted.  Keeping
the contract here first prevents a module-federation dependency or reverse
imports during a product-boundary migration.
