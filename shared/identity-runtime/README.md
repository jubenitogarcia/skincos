# Identity runtime adapter

The stable data contract is `shared/identity-contract`. During the compatible
cutover, the existing signed cookie and `crm_*` D1 tables remain authoritative.
This folder is the registered adapter allowed to delegate to Identity while
Inventory keeps `/auth/*` mounted and the API keeps `shared/crm-auth` stable.

The next cutover binds a dedicated Identity Worker to consumers. It must keep
the session cookie payload (`username`, `sv`, `csrf`, `exp`) and actor contract
compatible before traffic is shifted. A rollback returns the binding to the
compatibility mount; it never deletes users, recovery records or sessions. No
D1 migration is part of this logical extraction.
