# Otty pi Unread Status Design

## Goal

Show green only for an unread pi completion on Otty-backed Agent 1–6 keys.

## Read rule

A completion is read only while **Otty is the macOS foreground application** and the completion's Otty tab is active. A selected tab remains unread (green) while Otty is behind another app.

## Data flow

The standalone pi extension adds optional `completionAt` only when `agent_settled` publishes idle. Session startup idle does not create a completion.

The Otty adapter keeps the completion timestamp per slot. The Stream Deck controller persists the most recently acknowledged timestamp per normalized Otty pane in `~/Library/Application Support/CodexDeck/otty-pi-read-receipts.json`. On each regular Otty poll it obtains the active tab through the existing Otty CLI result and checks whether Otty is foreground with macOS `osascript`.

When foreground Otty's active tab contains a pi record with a newer completion, the controller writes the receipt. A `processing` or `awaiting` record keeps its normal visual status; an idle record is `complete` only when its completion timestamp is newer than its receipt and otherwise is `idle`.

## Failure behavior

- If foreground detection fails, do not acknowledge; an unread completion remains green.
- If receipt storage is unreadable or corrupt, start with no receipts; existing completions remain green until read.
- Missing, stale, non-pi, and empty tabs remain empty.
- The feature does not read, set, or depend on Otty's badge state because the CLI does not expose badge read status.

## Validation

Unit tests cover idle-without-completion, newer/unacknowledged completion, acknowledged completion, and foreground-active receipt behavior. Run typecheck, full tests, build, Stream Deck validation, standalone pi-extension typecheck, and packaged-version assertion.
