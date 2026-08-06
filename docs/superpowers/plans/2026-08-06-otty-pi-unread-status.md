# Otty pi Unread Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Otty-backed pi keys green only for unread completions, retaining green while Otty is behind another app.

**Architecture:** The pi extension records only real completion events. `src/otty.ts` maps records to slots, maintains a small local receipt map keyed by normalized pane ID, and derives `complete` only when a completion is newer than its receipt. The controller reads/writes that map and acknowledges the selected tab only when `osascript` reports Otty as macOS foreground.

**Tech Stack:** TypeScript, pi extension API, Node `fs/promises`, macOS `osascript`, Otty CLI, Node test runner.

## Global Constraints

- Use Otty CLI tab/pane JSON only; never read or modify Otty internals.
- A tab is read only when Otty is frontmost and that tab is active.
- Foreground-check failures must preserve unread state.
- Store receipts locally at `~/Library/Application Support/CodexDeck/otty-pi-read-receipts.json`, mode `0600`.
- Publish no prompts or responses; only completion timestamps and existing local state.
- Bump package version to `0.7.0-hotfix.10` and manifest version to `0.7.0.10`.

---

### Task 1: Publish and derive unread pi completion state

**Files:**
- Modify: `extensions/otty-pi-agent-state.ts`
- Modify: `src/status.ts`
- Modify: `src/otty.ts`
- Modify: `test/otty.test.ts`

**Interfaces:**
- Consumes: pi `agent_settled` and existing Otty tab/pane records.
- Produces: `OttyAgentSlot = { tabId, paneId, title, status, selected, completionAt?, contextUsedPercent? }`.
- Produces: `applyOttyReadReceipts(slots, receipts, ottyForeground): { slots: OttyAgentSlot[]; receipts: Record<string, number>; changed: boolean }`.

- [ ] **Step 1: Write failing unread-state tests**

Add tests that create an idle record with `completionAt: 100` and assert these cases:

```ts
const receipt = { "pane-1": 100 };
const result = applyOttyReadReceipts([{
  tabId: "tab-1", paneId: "pane-1", title: "one", status: "idle", selected: false, completionAt: 100
}], receipt, false);
assert.equal(result.slots[0]?.status, "idle");

const unread = applyOttyReadReceipts([{
  tabId: "tab-1", paneId: "pane-1", title: "one", status: "idle", selected: false, completionAt: 101
}], receipt, false);
assert.equal(unread.slots[0]?.status, "complete");

const read = applyOttyReadReceipts([{
  tabId: "tab-1", paneId: "pane-1", title: "one", status: "idle", selected: true, completionAt: 101
}], receipt, true);
assert.equal(read.slots[0]?.status, "idle");
assert.equal(read.receipts["pane-1"], 101);
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `npx tsx --test test/otty.test.ts`

Expected: FAIL because `applyOttyReadReceipts` is not exported.

- [ ] **Step 3: Publish only real completions**

In `extensions/otty-pi-agent-state.ts`, make `publish` accept an optional completion timestamp:

```ts
async function publish(state: State, ctx: any, completionAt?: number): Promise<void> {
  // existing value
  ...(completionAt != null ? { completionAt } : {})
}
```

Keep `session_start`, `before_agent_start`, and `tool_call` calls without a completion timestamp. Change the settled handler to:

```ts
pi.on("agent_settled", (_event, ctx) => publish("idle", ctx, Date.now()).catch(() => {}));
```

- [ ] **Step 4: Implement the minimal unread reducer**

Change `visualStatusFromOtty("idle")` in `src/status.ts` to return `"idle"`.

In `src/otty.ts`, add optional `completionAt` to `PiRecord` and validate it as a finite positive number before forwarding it. Add required normalized `paneId` and optional `completionAt` to `OttyAgentSlot`.

Export:

```ts
export function applyOttyReadReceipts(
  slots: Array<OttyAgentSlot | undefined>,
  receipts: Record<string, number>,
  ottyForeground: boolean
): { slots: Array<OttyAgentSlot | undefined>; receipts: Record<string, number>; changed: boolean }
```

Clone the receipt map. For each slot with `selected === true`, a numeric `completionAt`, and `ottyForeground === true`, advance the pane receipt to `completionAt` only when it is newer. Mark a slot `complete` only when its base status is `idle` and `completionAt` is newer than its receipt. Preserve all non-idle statuses and undefined slots.

- [ ] **Step 5: Run the targeted test and verify success**

Run: `npx tsx --test test/otty.test.ts`

Expected: PASS; acknowledged idle is not green, newer background completion is green, and foreground-active acknowledgement clears green.

- [ ] **Step 6: Commit the isolated state change**

```bash
git add extensions/otty-pi-agent-state.ts src/status.ts src/otty.ts test/otty.test.ts
git commit -m "feat(otty): track unread pi completions"
```

### Task 2: Persist receipts and acknowledge only foreground Otty tabs

**Files:**
- Modify: `src/otty.ts`
- Modify: `src/controller.ts`
- Modify: `test/otty.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `static/manifest.json`

**Interfaces:**
- Consumes: `applyOttyReadReceipts`, `codexDeckStateRoot()`, and macOS frontmost-app name.
- Produces: persistent receipt map at `otty-pi-read-receipts.json`.

- [ ] **Step 1: Write failing receipt-storage and foreground tests**

Use a temporary directory to test `readOttyReadReceipts(path)` returns `{}` for missing or malformed data and `writeOttyReadReceipts(path, { "pane-1": 101 })` persists exact JSON with a trailing newline. Add an injected command test for `isOttyForeground` that returns true only when stdout is `"Otty\n"`.

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `npx tsx --test test/otty.test.ts`

Expected: FAIL because the receipt and foreground helpers do not exist.

- [ ] **Step 3: Implement storage and conservative foreground detection**

In `src/otty.ts`, add exports:

```ts
export async function readOttyReadReceipts(path = join(codexDeckStateRoot(), "otty-pi-read-receipts.json")): Promise<Record<string, number>>
export async function writeOttyReadReceipts(receipts: Record<string, number>, path = join(codexDeckStateRoot(), "otty-pi-read-receipts.json")): Promise<void>
export async function isOttyForeground(run = (args: string[]) => execFileAsync("/usr/bin/osascript", args, { timeout: 3000 }).then(({ stdout }) => stdout)): Promise<boolean>
```

`isOttyForeground` must call:

```ts
["-e", 'tell application "System Events" to get name of first application process whose frontmost is true']
```

and return `stdout.trim() === "Otty"`; catch errors and return `false`. `writeOttyReadReceipts` creates the parent directory and uses a same-directory temporary file, `rename`, UTF-8, and mode `0o600`. Accept only a plain object with finite nonnegative numeric receipt values; reject all other parsed values by returning `{}`.

- [ ] **Step 4: Wire receipts into Otty refresh**

In `Controller`, add an `ottyReadReceipts: Record<string, number> = {}` field. In `start()`, load it once with `readOttyReadReceipts()`; catch failures and retain `{}`.

In the Otty branch of `refreshOnce()`, after `readOttyAgentSlots()`:

```ts
const result = applyOttyReadReceipts(this.ottySlots, this.ottyReadReceipts, await isOttyForeground());
this.ottySlots = result.slots;
if (result.changed) {
  this.ottyReadReceipts = result.receipts;
  await writeOttyReadReceipts(result.receipts);
}
```

If the foreground check or receipt write fails, log once and retain the old receipt map; do not clear any unread status.

- [ ] **Step 5: Run targeted tests and full verification**

Run:

```bash
npx tsx --test test/otty.test.ts
npm run check
npm test
```

Expected: all targeted and full tests pass.

- [ ] **Step 6: Bump, build, and validate the installable plugin**

Run:

```bash
npm version 0.7.0-hotfix.10 --no-git-tag-version
```

Set `static/manifest.json` `Version` to `0.7.0.10`, then run:

```bash
npm run build
streamdeck validate dist/com.simeo.codex-deck.sdPlugin
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck extensions/otty-pi-agent-state.ts
node -e 'const fs=require("fs"); const p=require("./package.json"); const m=JSON.parse(fs.readFileSync("static/manifest.json")); const d=JSON.parse(fs.readFileSync("dist/com.simeo.codex-deck.sdPlugin/manifest.json")); if(p.version!=="0.7.0-hotfix.10"||m.Version!=="0.7.0.10"||d.Version!==m.Version) process.exit(1)'
```

Expected: build, validation, extension typecheck, and version assertion pass.

- [ ] **Step 7: Commit**

```bash
git add src/otty.ts src/controller.ts test/otty.test.ts package.json package-lock.json static/manifest.json
git commit -m "feat(otty): show unread pi completions"
```
