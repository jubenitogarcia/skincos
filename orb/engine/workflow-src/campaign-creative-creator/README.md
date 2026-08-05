# Campaign Creative Creator source contract

The canonical input for this builder is the private migration baseline exported
from Orb/n8n. The baseline is intentionally kept outside Git because n8n exports
may contain credential bindings. The committed manifest records its immutable
workflow/version identity, checksum, and structural counts without copying the
credential-bearing export into the repository.

Builds are deterministic transformations of that baseline:

```text
private baseline export
        |
        v
build-campaign-creative-creator-continuous.js
        |
        +--> campaign-creative-creator.v3.json
        +--> campaign-creative-creator-error-handler.v3.json
        +--> campaign-creative-creator.module-fixtures.v3.json
        `--> campaign-creative-creator.package.json
```

The main workflow is an inactive, import-ready candidate. Generated JSON has
credential bindings stripped for Git and requires credential rebinding during a
separate reviewed n8n import. The module fixture catalog is not connected to
the operational graph.

Baseline reference:

`C:\CodexRuntime\operator\admin\skincos\campaign-creative-creator\source-941bec10-3e41-49be-baed-753ca60787ad.json`

The builder must fail if the canonical workflow identity or expected 107-node
source shape changes unexpectedly. No import, activation, paid provider call,
or publication is part of this build.
