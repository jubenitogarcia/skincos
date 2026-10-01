# Execution loop

Persist an internal mission before mutation. Keep the same milestone active until done or a real human decision is needed. Fix introduced CI failures; separate a safely-fixable global unblock into its own PR. Do not open an unrelated architecture front.

In `supervisor-cycle`, the original thread objective and later commitments take
precedence over unrelated ready queue items. Execute one minimum safe milestone
per cycle, reconcile its result before choosing another, and do not return
`continue` unless measurable progress occurred. A PR, running check, health
response or local worktree is an intermediate state, not completion evidence.
