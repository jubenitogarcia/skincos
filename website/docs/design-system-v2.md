# Design System v2 (Conversion Layer)

## Objective
Create a shared conversion layer for high-intent pages (`/`, `/agendamento`, `/unidades`, `/doutores`) so experiments can move faster without visual drift.

## Tokens
Defined in [src/styles/globals.css](/Users/jubenitogarcia/.codex/worktrees/a692/website/src/styles/globals.css):

- `--ds-surface-main`
- `--ds-surface-soft`
- `--ds-border-soft`
- `--ds-pill-bg`
- `--ds-primary-bg`
- `--ds-primary-fg`

## Shared UI patterns

### `ConversionIntentRail`
Component: [src/components/ConversionIntentRail.tsx](/Users/jubenitogarcia/.codex/worktrees/a692/website/src/components/ConversionIntentRail.tsx)

Use for intent-first decision blocks with one clear CTA per card.

### Decision Cards
Styles: `.decisionCard*` in [src/styles/globals.css](/Users/jubenitogarcia/.codex/worktrees/a692/website/src/styles/globals.css)

Use for local evidence, authority support, and pathway explanation.

## Governance

1. All new conversion sections should use DS v2 tokens.
2. Each new CTA block must emit analytics events with experience/variant context.
3. Visual baseline should be updated only after approved redesigns.
4. Every conversion redesign must pass:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run smoke:strict`
   - `npm run audit:360`

## Experiment cadence

Every 15 days:

1. Propose 2-3 variant hypotheses (headline, proof stack, CTA framing).
2. Roll out through experience variants.
3. Compare by:
   - `cta_booking_start`
   - `booking_funnel_step`
   - `booking_request_submitted`
4. Promote winner and refresh visual baseline.
