# Otty pi Context Ring Design

## Goal

Show each assigned pi session's context-window utilization with the existing Stream Deck agent context ring when Agent source is set to **Otty pi tabs**.

## Data flow

The standalone `otty-pi-agent-state.ts` extension will calculate a bounded percentage from pi's current context usage and the active model's context-window capacity when it publishes a state record. The record adds an optional `contextUsedPercent` field; existing records remain valid.

`src/otty.ts` will validate and forward that optional percentage into `OttyAgentSlot`. The existing agent renderer receives the same field it already uses for Codex slots, so it draws the existing ring without an Otty-specific UI path.

## Behavior

- A known percentage is clamped to 0–100 and shown by the existing ring.
- If pi does not expose usage or capacity, the field is omitted and the renderer keeps its existing unknown/pending treatment.
- Empty, non-pi, stale, or unassigned Otty tabs remain empty and have no ring.
- This remains local-only: the state file contains only the percentage, not prompt or response content.

## Validation

Add unit coverage that an Otty record's context percentage survives the adapter join and that invalid percentages are ignored. Run typecheck, full tests, build, Stream Deck validation, and standalone-extension typecheck.
