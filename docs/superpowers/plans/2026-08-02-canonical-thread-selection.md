# Canonical Thread Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent keys reliably select local and remote-host threads after Codex prefixes sidebar IDs, and foreground Codex on the owning host before selection.

**Architecture:** The renderer bridge will convert a renderer/sidebar identity such as `local:<UUID>` (or another host-prefixed identity) to the canonical task key used in snapshots. Relay commands remain unchanged: they continue to reach the owning bridge, which normalizes IDs locally. A platform-local activation helper runs only for agent key-down before dispatching or opening a task.

**Tech Stack:** TypeScript, Node.js test runner, WebSocket Chrome DevTools bridge, macOS `open` and Windows PowerShell process launchers.

## Global Constraints

- Preserve typed relay routing and do not expose Chrome DevTools through the relay.
- Do not change host ownership or use task title as identity.
- Normalize renderer host prefixes and temporary task aliases only for DOM comparison; canonical dispatch keys remain unchanged.
- Activate only the host which receives the command; remote selection continues through its existing relay command.

---

### Task 1: Canonical selection and host activation

**Files:**

- Modify: `src/codex-micro-renderer-bridge.ts`
- Modify: `src/codex-open.ts`
- Modify: `test/micro-bridge.test.ts`
- Modify: `test/codex-open.test.ts`

**Interfaces:**

- Produces: `canonicalThreadId(threadKey: string): string`, used only to compare renderer DOM IDs.
- Produces: `activateCodex(): Promise<void>`, invoked by `sendAgent` only for `act === 1`.

- [ ] **Step 1: Write failing canonical-ID tests**

```ts
assert.equal(canonicalThreadId("local:019f6de7-44c2-7fe2-9d17-9322c952e626"), "019f6de7-44c2-7fe2-9d17-9322c952e626");
assert.equal(canonicalThreadId("remote-ssh-codex-managed:mlgpu:019f6de7-44c2-7fe2-9d17-9322c952e626"), "019f6de7-44c2-7fe2-9d17-9322c952e626");
```

- [ ] **Step 2: Run the focused bridge test and verify it fails because the helper is missing**

Run: `npm test -- test/micro-bridge.test.ts`

- [ ] **Step 3: Write failing platform-activation tests**

```ts
assert.deepEqual(codexActivateSpec("darwin"), { executable: "/usr/bin/open", args: ["-a", "Codex"], windowsHide: false });
assert.match(codexActivateSpec("win32").args.join(" "), /AppActivate/);
```

- [ ] **Step 4: Run the focused launcher test and verify it fails because the helper is missing**

Run: `npm test -- test/codex-open.test.ts`

- [ ] **Step 5: Implement the minimal helpers and call activation before agent key-down dispatch**

```ts
if (act === 1) await activateCodex();
```

Only canonicalize DOM-side comparisons; preserve `threadKey` exactly in dispatch and relay payloads.

- [ ] **Step 6: Run focused tests, then the complete test suite, type check, and build**

Run: `npm test -- test/micro-bridge.test.ts test/codex-open.test.ts && npm test && npm run check && npm run build`

- [ ] **Step 7: Inspect the installed bridge’s plugin log after pressing an agent key**

Expected: no `did not activate the requested thread` error and no Stream Deck alert; remote-host agent keys route without their identity being rewritten in the relay payload.
