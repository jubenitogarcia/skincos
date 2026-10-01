# Evidence model

Record UTC time, source, command/URL/run/deployment identifier, environment, result, limitation, SHA and PR. Health proves reachability; journey proof needs intended flow and expected/negative behavior.

For supervised cycles, include stable local paths, event keys, test/run IDs,
commit/PR/check identifiers and environment labels in `evidence_refs`. Never
place secrets, cookies, tokens or raw authentication material in the contract.
`complete` requires evidence for the original objective, not merely the most
recent subtask.
