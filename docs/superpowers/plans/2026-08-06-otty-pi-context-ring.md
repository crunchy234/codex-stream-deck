# Otty pi Context Ring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show pi context-window usage with the existing agent context ring for Otty pi tabs.

**Architecture:** The standalone pi extension publishes an optional, bounded percentage in the existing local state record. The Otty adapter validates and preserves it, and the controller passes it to the existing renderer ring path; no new UI, Otty API, or storage is added.

**Tech Stack:** TypeScript, pi extension API, Node test runner, Stream Deck SDK.

## Global Constraints

- Use `ctx.getContextUsage()`; do not read pi session files.
- Keep all data local; publish only the percentage, never prompt or response content.
- Preserve empty/missing/stale tab behavior.
- Do not modify Otty.app, its CLI, or private SQLite files.
- Bump package version to `0.7.0-hotfix.9` and Stream Deck manifest version to `0.7.0.9` for the required plugin update.

---

### Task 1: Carry pi context usage to the existing ring

**Files:**
- Modify: `extensions/otty-pi-agent-state.ts`
- Modify: `src/otty.ts`
- Modify: `src/controller.ts:783-786`
- Modify: `test/otty.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `static/manifest.json`

**Interfaces:**
- Consumes: `ctx.getContextUsage(): { percent: number | null } | undefined`.
- Produces: `OttyAgentSlot.contextUsedPercent?: number`, passed to `renderAgentKey()`.

- [ ] **Step 1: Write the failing adapter test**

Add this test to `test/otty.test.ts`:

```ts
test("preserves a valid pi context percentage for the existing ring", () => {
  const slots = joinOttyAgentSlots(
    [{ id: "tab-1", index: 0, title: "one", active: false }],
    [{ id: "pane-1", tab_id: "tab-1" }],
    [{ version: 1, paneId: "pane-1", pid: 101, sessionId: "a", cwd: "/a", state: "idle", updatedAt: 1, contextUsedPercent: 42 }],
    () => true
  );
  assert.equal(slots[0]?.contextUsedPercent, 42);
});
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `npx tsx --test test/otty.test.ts`

Expected: FAIL because `OttyAgentSlot` does not expose `contextUsedPercent`.

- [ ] **Step 3: Implement the minimal state, adapter, and render wiring**

In `extensions/otty-pi-agent-state.ts`, add a helper and spread its result into the JSON record:

```ts
function contextUsedPercent(ctx: any): number | undefined {
  const percent = ctx.getContextUsage?.()?.percent;
  return typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : undefined;
}

// Inside JSON.stringify:
...(contextUsedPercent(ctx) != null ? { contextUsedPercent: contextUsedPercent(ctx) } : {}),
```

Store the helper result once before serialization rather than calling it twice:

```ts
const percent = contextUsedPercent(ctx);
const value = JSON.stringify({
  // existing fields
  ...(percent != null ? { contextUsedPercent: percent } : {})
}) + "\n";
```

In `src/otty.ts`, add `contextUsedPercent?: number` to `PiRecord` and `OttyAgentSlot`. Add a local validator:

```ts
function contextUsedPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}
```

When constructing a slot, include:

```ts
...(contextUsedPercent(record.contextUsedPercent) != null
  ? { contextUsedPercent: contextUsedPercent(record.contextUsedPercent) }
  : {})
```

Store the validated result once in a local variable before building the object. Invalid or absent values must omit the property without discarding an otherwise valid state record.

In `src/controller.ts`, replace the Otty `renderAgentKey()` tail arguments:

```ts
this.animationFrame, "dark", undefined, "ready", undefined, false
```

with:

```ts
this.animationFrame, "dark", undefined, "ready", tab?.contextUsedPercent, this.showContextRings
```

- [ ] **Step 4: Run the targeted test and verify success**

Run: `npx tsx --test test/otty.test.ts`

Expected: PASS, including the new context-percent case.

- [ ] **Step 5: Bump the installable plugin version**

Run:

```bash
npm version 0.7.0-hotfix.9 --no-git-tag-version
```

Then set the `Version` field in `static/manifest.json` to `0.7.0.9`.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run check
npm test
npm run build
streamdeck validate dist/com.simeo.codex-deck.sdPlugin
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck extensions/otty-pi-agent-state.ts
node -e 'const fs=require("fs"); const p=require("./package.json"); const m=JSON.parse(fs.readFileSync("static/manifest.json")); const d=JSON.parse(fs.readFileSync("dist/com.simeo.codex-deck.sdPlugin/manifest.json")); if(p.version!=="0.7.0-hotfix.9"||m.Version!=="0.7.0.9"||d.Version!==m.Version) process.exit(1)'
```

Expected: typecheck, tests, build, Stream Deck validation, extension typecheck, and packaged-version assertion all pass.

- [ ] **Step 7: Commit**

```bash
git add extensions/otty-pi-agent-state.ts src/otty.ts src/controller.ts test/otty.test.ts package.json package-lock.json static/manifest.json
git commit -m "feat(otty): show pi context usage"
```
