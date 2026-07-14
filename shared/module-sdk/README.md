# Skincos module SDK

`shared/module-sdk` is the only UI integration boundary between the CRM console
and an extracted product module.  A module exposes metadata, authorization
requirements and a lazy view through this contract; it never imports CRM
internals.

The concrete TypeScript package is created when the first CRM capability is
extracted.  Keeping the contract here first prevents a module-federation
dependency or reverse imports during the path migration.
