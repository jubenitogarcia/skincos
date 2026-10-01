# Authorization boundaries

Local/GitHub lifecycle and reversible synthetic staging are autonomous. Production, real users, destructive data, secrets, purchases, transfer and business permissions need explicit human authorization.

`supervisor-cycle` inherits the original request's scope; a Stop-generated
continuation is not new user authorization. It may commit, push, open/update a
single-purpose PR, follow CI, fix introduced failures and merge only when the
existing repository gates permit. It must stop before production deploys,
production migrations, production secrets, real-user changes, grants, feature
flag activation, OAuth consent, administrative access, irreversible actions or
self-approval of hook trust. Emit the narrow terminal blocker that applies.
