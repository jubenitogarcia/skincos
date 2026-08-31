# SKINCOS WhatsApp adapter pre-cut closure

This directory is an inspection-only portable closure. Its package is private,
uses the pre-cut version, and has no publisher, deployment, runtime, service,
secret, or state migration capability.

The closure contains only the CRM HTTP adapters and their tests. It does not
contain Evolution source, the CRM message metadata store, CRM routes, systemd
units, release scripts, or Platform/Ops coordination code.

Before any repository is created or package is published, the canonical
monorepo runner—not this portable copy—must inspect the directory or regular
TAR and its external evidence document. It binds this validator's exact
SHA-256 before it reads the candidate, then verifies the reviewed source
commit/tree, closure digest, optional archive digest, adapter source digests,
prohibited paths, and all four required cutover facts. The portable validator
requires that independently supplied identity but is not a trust root by
itself. While the boundary status is pre-cut, both controls exit fail-closed
even if a candidate is otherwise structurally valid.
