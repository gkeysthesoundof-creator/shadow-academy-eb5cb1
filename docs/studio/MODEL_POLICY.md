# Model-Selection Policy — Romans World

Status: **In force** — Canon Update 03 (Fable-first development).
Supersedes: all earlier model-selection instructions in the Romans World project kit.
Scope: this repository only.

## Assignment table

| Work type | Model | Effort |
|---|---|---|
| Studio direction, architecture, major development | Fable 5.2 (`claude-fable-5-2`) or latest Fable | High |
| Gameplay implementation, educational systems, creative craftsmanship | Fable | High |
| Complex engineering | Fable | High |
| Independent code / design review | Opus 5.5 (`claude-opus-5-5`) | High |
| Difficult debugging (after a first Fable attempt stalls) | Opus | High |
| Child-safety and privacy evaluations | Opus | High |
| Routine maintenance, minor fixes, straightforward content entry | Sonnet 5.5 (`claude-sonnet-5-5`) | Medium |

## Rules

1. **Session default is Fable.** Start Romans World sessions on Fable (`/model` in Claude Code).
   If a session is found running on another model, record it on the State Card and recommend
   the switch before the next Work Order.
2. **Agents inherit.** Specialist agents run on the session model. Override only when the
   assigned task itself calls for another model — chiefly an independent Opus review, where
   a different model is the point.
3. **Independence of review.** An Opus review receives the code and the Work Order, not the
   author's conclusions, so it is not anchored on them.
4. **Effort is set by the work, not the budget.** High for architecture and major development.
   Lower only for routine tasks.
5. **Availability is not scope.** Unused Fable usage never justifies extra features, extra
   agents, skipped tests or bypassed approval gates.
6. **Fallback.** If Fable is unavailable, continue on Opus at High effort and note it on the
   State Card. Do not silently downgrade to Sonnet for major work.

## Change control

Only Gerald amends this policy, by numbered Canon Update. Record each amendment in
`docs/studio/CANON.md`.
