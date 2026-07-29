# Privacy and security

The local Vite harness returns only synthetic local-auth data. Artifacts live under ignored `artifacts/`; they can contain screenshots, traces or rendered text and must never be committed. Session replay is disabled because no analytics vendor is configured. Do not route clinical, financial, workforce, registration or production traffic through audit tooling.

The baseline does not suppress axe violations. `A11Y_ENFORCE=1` turns recorded automatic violations into failures after the initial review. Manual accessibility checks remain required for keyboard order, semantics, content and assistive technology behavior.
