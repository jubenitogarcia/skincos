# SKINCOS WhatsApp adapter pre-cut closure

This directory is an inspection-only portable closure. Its package is private,
uses the pre-cut version, and has no publisher, deployment, runtime, service,
secret, or state migration capability.

The closure contains only the CRM HTTP adapters and their tests. It does not
contain Evolution source, the CRM message metadata store, CRM routes, systemd
units, release scripts, or Platform/Ops coordination code.

Before any repository is created or package is published, run the candidate gate
with the directory or a regular TAR archive and an external evidence document.
The gate verifies the reviewed source commit/tree, closure digest, optional
archive digest, SHA-256 values for the reviewed adapter sources, prohibited
paths, and all four required cutover facts. While
the boundary status is pre-cut, the gate exits fail-closed even if a candidate is
otherwise structurally valid.
