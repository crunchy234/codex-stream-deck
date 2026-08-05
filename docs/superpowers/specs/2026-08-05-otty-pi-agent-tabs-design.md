# Otty pi agent tabs

## Goal

Reuse the existing `Agent 1` through `Agent 6` Stream Deck actions for Otty. Each key represents the Otty tab with the corresponding one-based position and focuses it when pressed. Keys show the pi session state for that tab; a tab without pi is empty.

## Scope

- Otty tabs 1–6 are the first six entries returned by `otty tab list --json` (zero-based indexes 0–5).
- A press runs `otty tab focus <tab-id>`.
- States map to existing agent art: `processing` → `thinking`, `idle` → `complete`, `awaiting` → `input`, no live pi state → `empty`.
- Missing Otty tabs also render empty and do nothing when pressed.
- Other Codex actions, relay support, keycaps, usage keys, and agent long-press behavior are not part of Otty mode.

## Architecture

A new standalone global pi extension writes one small JSON file per pi process beneath the Codex Deck state directory. The record contains the injected `OTTY_PANE_ID`, pi PID, session ID, cwd, and current lifecycle state. It updates on pi session start, agent start/tool use, settle, and shutdown. The extension writes atomically and does not modify Otty.app or its CLI.

The plugin polls Otty with its supported CLI:

1. `otty tab list --json` returns tabs and their IDs.
2. `otty pane list --json` associates each tab with its pane IDs.
3. The plugin joins pane IDs to live pi records, rejects records whose PIDs no longer exist, and fills agent slots 1–6 from tab indexes 0–5.
4. Pressing an assigned key calls `otty tab focus <tab-id>`.

The adapter is isolated from the existing Codex CDP bridge so Otty mode only registers/renders the six agent keys and needs no Codex installation.

## Error handling

If Otty is unavailable, returns malformed JSON, or a record is stale, the relevant key renders empty. A focus failure surfaces the existing Stream Deck alert. Poll failures are logged once per changed error, not per key.

## Tests

Unit tests cover:

- tab index 0–5 mapping to Agent 1–6;
- tab focus command construction;
- all pi-state-to-agent-visual-status mappings;
- a non-pi tab, a missing tab, malformed Otty output, and a dead PID rendering empty;
- a pane-to-tab join where a tab has multiple panes.
