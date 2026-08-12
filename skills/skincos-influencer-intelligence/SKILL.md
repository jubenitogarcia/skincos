---
name: skincos-influencer-intelligence
description: Analyze, compare, rank, and explain Instagram creators using the SKINCOS Influencer Intelligence read-only MCP, deterministic scores, campaign-fit evidence, confidence, coverage, freshness, and limitations. Use for requests such as "analise @creator", "esse influencer é bom?", "compare estes influencers", "qual creator devemos usar?", "rank influencers para esta campanha", or "por que esse creator recebeu essa nota?".
---

# SKINCOS Influencer Intelligence

Use this skill for evidence-backed creator analysis. Query the approved
Influencer Intelligence MCP before drawing conclusions; do not substitute
memory, browser scraping, provider calls, SQL, shell, or a mental recreation of
the scoring formula.

## Workflow

1. Resolve a handle or name with `search_creators`. Use the opaque
   `creator_key` returned by the service for every later call. For comparisons,
   resolve every creator and keep identities distinct.
2. Read `get_creator_profile`, `get_creator_snapshots`, `get_creator_media`,
   `get_creator_analytics`, and `get_creator_score` as needed. Use
   `compare_creators` for a bounded comparison. Use the Campaign Fit tool only
   when it is explicitly registered and the user supplied a campaign brief.
3. Treat `stale`, `not_computed`, and `unavailable` as meaningful states. If an
   analysis is absent or stale, report the limitation and do not invent a
   number, backfill history, or silently start an expensive operation.
4. Present the service's persisted deterministic score and explanations. Never
   recalculate weights, benchmarks, confidence, or coverage in prose.

## Evidence rules

- Keep `observed`, `derived`, `inferred`, and `unavailable` visibly distinct.
  `freshness` may be `fresh`, `stale`, or `unknown`; never turn freshness into
  a quality judgment.
- Always show `Confidence` and `Data Coverage` on a 0--100 scale when supplied,
  plus `algorithm_version`, `weights_version`, providers, retrieved time, and
  relevant evidence or limitations.
- Missing data stays unavailable/null, never zero. A low score and low
  confidence are different conclusions; do not express low confidence as a
  penalty to the creator.
- Followers are scale context, not quality. Compare normalized rates and
  follower-tier benchmarks only when the service marks the benchmark available;
  otherwise state that the benchmark is unavailable.
- Treat a viral post as an outlier pattern and a follower spike as a bounded
  suspicious-growth signal. Never call a creator or audience fraudulent without
  direct, sufficient evidence.
- Do not infer age, gender, geography, audience quality, or fake followers from
  missing or indirect signals. Use the service's evidence state and confidence.
- Keep general creator quality separate from campaign fit. Campaign fit must be
  contextualized to the supplied brief; missing demographics lower fit
  confidence rather than becoming invented demographics.

## Response format

For one creator, use this compact structure:

```text
Creator
Overall Score
Confidence
Data Coverage

Component scores

Key positives
Warnings
Data limitations
Recommendation
```

Keep recommendations proportional to evidence. Explain why a result is
available, stale, inferred, or unavailable, and distinguish a general-quality
recommendation from a campaign-specific recommendation. For comparisons, show
normalized dimensions, component differences, confidence/coverage, tier
context when available, and unresolved limitations; do not rank by follower
count alone.

## Hard boundaries

Use only the approved read-only MCP and internal service contract. Never expose
tokens, sessions, credentials, raw provider payloads, unnecessary commenter
identity, direct PII, raw comments/media, or internal authorization context.
Never call Meta Graph, instagrapi, Instaloader, Apify, Modash, or another
provider directly. Never execute SQL/shell, scrape, activate Orb jobs, or
perform follow, like, post, DM, publish, or other Instagram write actions.

If the MCP is unavailable, return a clear unproven/unavailable result and name
the missing evidence; do not fall back to fabricated metrics or external
search. A later request may explicitly authorize a separate governed
collection operation, but this skill remains read-only.
