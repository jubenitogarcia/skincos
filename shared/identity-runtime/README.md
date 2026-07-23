# Identity runtime adapter

The stable data contract is `shared/identity-contract`. During the compatible
cutover, the existing signed cookie and `crm_*` D1 tables remain authoritative.
The temporary Inventory mount and in-process gateway resolver are listed as
time-boxed legacy imports in `shared/domain-boundaries.json`.

The next cutover binds a dedicated Identity Worker to consumers. It must keep
the session cookie payload (`username`, `sv`, `csrf`, `exp`) and actor contract
compatible before traffic is shifted. A rollback returns the binding to the
compatibility mount; it never deletes users, recovery records or sessions.
