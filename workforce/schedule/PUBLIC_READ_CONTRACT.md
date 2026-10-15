# schedule-public-read/v1

This private GET-only boundary projects Schedule-owned staff and availability
for Website. Source configuration is disabled by default. A source change or
successful upload does not attest activation, delivery or Website cutover.
The core remains the owner of D1; the adapter has a private service binding,
no D1 binding and a per-nonce Durable Object replay guard.

## Authentication and routes

Two distinct normalized HMAC capabilities are required:

- SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: Website and adapter, service
  website-booking.
- SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: adapter and Schedule core, service
  schedule-public-read-adapter.

Both keys must be present and different. The edge key cannot authenticate a
request to core. These capabilities are independent from ESCALA_ACTOR_HMAC_KEY.
The canonical signing string binds version, timestamp, nonce, GET, exact
path/query and service. Nonces match
`^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$`; skew is at most five minutes.
A per-nonce Durable Object accepts the edge envelope once. Replay is 409;
a missing or failed guard is 503.

- GET /health verifies that the adapter is enabled and fully bound.
- GET /schedule-public-read/v1/readiness verifies current primary-backed
  schema and both public rosters. Readiness alone is not a DTO acceptance proof.
- GET /schedule-public-read/v1/professionals?unit=<unit>
- GET /schedule-public-read/v1/availability?unit=<unit>&date=YYYY-MM-DD

Versioned requests accept exactly their required query keys once each. Dates
must be real ISO calendar dates. The two canonical response units are
novo-hamburgo and barra-shopping-sul. Explicit legacy input labels
Novo Hamburgo/novohamburgo and BarraShoppingSul are normalized to those units.
The core derives its existing D1 unit label without rewriting source records.

## Public identities and eligibility

Only profiles with explicit Ativo status, comma-separated exact role token
Injetor, and membership in the requested unit are eligible. Blank or inactive
status, Consultor, Diretor, Gerente and unrelated roles are excluded. Roster
and availability use this identical projection.

The existing professionals.id UUID is the identity source. Four exact
UUID-to-public-alias mappings with their established unit memberships are
allowlisted in public-read-professional-identities.js. They do not change
status or eligibility. Other eligible profiles retain their existing UUID;
no identity is inferred from a name, nickname, Instagram handle or partial
match. An absent source UUID is not synthesized.

Availability uses schedule_entries.professional_id when present. A nullable
historical reference can resolve only through equality to the exact UNIQUE
current professional name and membership in that unit. A nonnull ID must
also agree with the exact name and membership. An unresolved, renamed or
cross-unit reference for the requested unit/date returns 503, including on a
closed day. Unrelated historical dates are not scanned or repaired. A resolved
inactive or nonclinical reference is explicitly excluded. No D1 migration or
DML is part of this projection.

The public DTO fields are:

- Professionals: {ok:true,contract:'schedule-public-read/v1',data:{unit,
  professionals:[{id,name}]}}.
- Availability: {ok:true,contract:'schedule-public-read/v1',data:{unit,date,
  closed,professionals:[{id,name}],professionalNames:[name]}}.
- Readiness: {ok:true,contract:'schedule-public-read/v1',ready:true,
  dependencies:{schedule:'available'}}.

professionalNames is the compatibility list in exactly the same order as
professionals. Public names and stable IDs are the only profile fields.
Phone, email, workforce identity, role, internal flags and patient data are
not returned. Duplicated IDs/names, unproved alias strings and an alias used
outside its allowlisted membership fail validation.

## Read consistency and budgets

Core reads only the necessary id/name/status/role/units_json fields and the
requested day's references/closed flags. Every request starts a D1 session
with first-primary and a SELECT-only batch. Responses use no-store.
There are at most 512 profiles and 512 day references; an extra row fails
closed rather than being silently truncated. Public names are bounded to
256 UTF-8 bytes. Source ID/status fields are bounded to 128 bytes, role and
units_json to 4096 bytes. The SELECT bounds these fields before materializing
them in the Worker; an overflow flag preserves the row and forces 503. It never
turns an oversized role into inactive status or an oversized ID into a
nullable historical reference. A complete JSON DTO must fit 64 KiB.

The adapter gives the core operation, including signing, fetch and actual
stream reading, one four-second deadline. It aborts stalled work, counts
actual bytes even if Content-Length is absent or false, uses strict UTF-8 JSON
decoding, and requires the genuine core contract header. It validates the
requested unit/date and rebuilds a fresh public DTO and headers. Provider
error text, cookies and arbitrary upstream fields/headers are not forwarded.
Every upstream failure is an explicit 503, with no read fallback or retry.

## Production acceptance and rollback

The existing staging/Actions publisher scripts retain their own authority,
predecessor and bootstrap contracts. The native manual publication lane uses
its own immutable manifest/receipt namespace and genuine coordinator lease;
it must never invent workflow/run IDs, Actions statuses or staging artifacts.
Its scripts are public-read-native-{release,manifest,receipts,authority,http}.mjs.
Publication requires a clean merged main SHA, scoped credential custody,
source/config digests, predecessor/readback proof, a disabled bootstrap, and
verified 100-percent deployment. Eligibility to act is distinct from cloud
permissions. No source flag bypasses those gates.

The ephemeral native verifier uses a distinct probe HMAC with service
schedule-production-verifier. GET /verify/public-projection accepts no query,
body, arbitrary path or caller-selected target. Source fixes the private
adapter binding, both units and today's date in America/Sao_Paulo. It performs
four signed GETs: each unit's roster and availability. It applies the same
public DTO validation, a 64 KiB budget per response and a four-second total
deadline, and verifies availability IDs/names are a subset of that roster.

That mode requires PROBE_SOURCE_SHA, a native UUID PROBE_NATIVE_RELEASE_ID and
PROBE_EXPIRES_AT_MS no more than thirty minutes ahead; expiration is rechecked
before each operation and completion. Its response contains only source SHA,
release UUID, date, units, counts, closed flags and SHA256 digests of validated
DTOs. It never returns profiles, names, upstream error bodies or credentials.
The existing /verify/ready and /verify/disabled checks remain available for
authentication/replay and disabled-state proofs, respectively; neither
substitutes for the public-projection acceptance result.

The native publisher must preserve legacy core management behavior, verify
actual active version/bindings and use its own source-bound rollback receipt.
Website cutover also requires consumer contract/identity and historical
booking overlap checks; a provider-local success cannot establish those.
