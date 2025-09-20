# AI Improvement Task Request

Please run an automated AI improvement pass for the SKINCOS AI superproject.

Context
- Event: ${{ github.event_name }}
- Actor: ${{ github.actor }}
- Ref: ${{ github.ref }}

Recent changes:
```
${{ env.CHANGES }}
```

Goals
- Analyze recent changes and propose small, safe improvements (tests, types, docs, small bug fixes, CI tweaks).
- Open a pull request with the improvements or comment an action plan if manual steps are required.

Constraints
- Prefer minimal, incremental changes with clear diffs.
- Respect submodule boundaries; avoid altering submodule code directly in this repo.
- Ensure CI passes.
