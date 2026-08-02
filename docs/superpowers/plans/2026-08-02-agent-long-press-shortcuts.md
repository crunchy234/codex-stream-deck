# Agent Long-Press Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one global long-press behavior for all Stream Deck agent keys: default owner-routed Codex transcription or a local macOS custom shortcut, while preserving short-press task selection and safe release semantics.

**Architecture:** Physical-action state is keyed by Stream Deck action ID and generation, not agent slot. The controller captures a `RoutedAgentSlot` at key-down, selects it through a new typed relay command when remote, then starts/stops the configured hold only if that same action remains held. The relay server owns remote-hold cleanup; macOS shortcut events are local and isolated from relay traffic.

**Tech Stack:** TypeScript, Elgato Stream Deck SDK, Node test runner, WebSocket relay, Chromium DevTools renderer bridge, macOS JXA/CoreGraphics.

## Global Constraints

- Short press selects/foregrounds the assigned task without dispatching the normal agent HID event.
- Long-press threshold is 450 ms from physical key-down.
- Only one global hold is active; each hold has a 60-second safety lease.
- Codex transcription always routes to the exact task owner captured at key-down.
- Custom shortcuts are macOS-local only and never cross the relay protocol.
- Store only validated numeric keycodes and modifier enums; never construct a script from user text.
- Preserve existing `showContextRings` global setting when writing long-press settings.

---

### Task 1: Typed remote thread selection and safe held-action leases

**Files:**

- Modify: `src/relay-protocol.ts`
- Modify: `src/codex-relay-server.ts`
- Modify: `src/codex-relay-client.ts`
- Modify: `src/codex-micro-renderer-bridge.ts`
- Modify: `src/controller.ts`
- Test: `test/relay.test.ts`
- Test: `test/micro-bridge.test.ts`

**Interfaces:**

- Produces `RelayCommand` variant `{ kind: "select-thread"; threadKey: string }`.
- Produces `CodexMicroRendererBridge.selectThread(threadKey: string): Promise<void>`.
- Produces relay server hold ownership keyed by `WebSocket`, with `releaseHeldActions(socket)`.

- [ ] **Step 1: Write failing protocol and relay tests**

```ts
assert.deepEqual(parseRelayCommand({ kind: "select-thread", threadKey }), {
  kind: "select-thread", threadKey
});
assert.equal(parseRelayCommand({ kind: "select-thread", threadKey: "../../bad" }), null);
// After action down then socket close, the server calls sendAction("ACT10_ACT11", 0).
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm test -- test/relay.test.ts`

Expected: FAIL because `select-thread` is not a valid command and socket-owned hold cleanup does not exist.

- [ ] **Step 3: Implement the narrow protocol and server handler**

```ts
export type RelayCommand =
  | { kind: "select-thread"; threadKey: string }
  | /* existing variants */;

if (command.kind === "select-thread") return control.selectThread(command.threadKey);
```

Track only action-down commands received from an authenticated socket. On matching action-up, socket close/error, server shutdown, or a 60-second timer, issue one matching action-up and remove the record. Do not lease ordinary agent, joystick, or encoder events.

- [ ] **Step 4: Extract bridge task selection from agent HID dispatch**

```ts
async selectThread(threadKey: string): Promise<void> {
  await this.focusCodex();
  await this.ensureThreadActivated(threadKey);
  this.sessionOwnership.markOpened(threadKey);
}
```

Keep `sendAgent` behavior unchanged for existing callers; it may reuse `selectThread` after its native HID dispatch.

- [ ] **Step 5: Add owner-identity enforcement in controller remote sends**

```ts
private async sendToPinnedOwner(owner: CodexHost, command: RelayCommand): Promise<void> {
  if (owner.hostId === this.localHost?.hostId) return this.dispatchLocal(command);
  if (this.relayClient?.currentHost()?.hostId !== owner.hostId) throw new Error("The task-owning Codex host is no longer connected.");
  await this.relayClient.send(command);
}
```

- [ ] **Step 6: Run focused tests, then commit**

Run: `npm test -- test/relay.test.ts test/micro-bridge.test.ts`

Commit:

```bash
git add src/relay-protocol.ts src/codex-relay-server.ts src/codex-relay-client.ts src/codex-micro-renderer-bridge.ts src/controller.ts test/relay.test.ts test/micro-bridge.test.ts
git commit -m "feat: relay explicit thread selection safely"
```

### Task 2: Global settings and physical long-press state machine

**Files:**

- Modify: `src/actions.ts`
- Modify: `src/controller.ts`
- Modify: `src/plugin.ts`
- Modify: `static/property-inspector/agent.html`
- Test: `test/long-press.test.ts`
- Test: `test/relay.test.ts`

**Interfaces:**

- Produces `LongPressSettings` with mode `"off" | "codex-transcription" | "macos-shortcut"` and an optional validated shortcut.
- Produces `DeckController.beginAgentPress(actionId, slot)`, `endAgentPress(actionId)`, and `cancelAgentPress(actionId)`.

- [ ] **Step 1: Write failing state-machine tests**

```ts
test("quick release selects once and never starts transcription", async () => {
  await machine.down("action-a", assignment); clock.advance(449); await machine.up("action-a");
  assert.deepEqual(calls, [["select", assignment.host.hostId, assignment.threadKey]]);
});

test("selection resolving after key-up cannot start transcription", async () => {
  const pending = machine.down("action-a", assignment); await machine.up("action-a"); resolveSelection(); await pending;
  assert.equal(calls.some(([kind]) => kind === "down"), false);
});
```

Also cover exactly-one active hold, duplicate down/up idempotency, settings change while held, 60-second lease, and remote-host replacement rejection.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm test -- test/long-press.test.ts`

- [ ] **Step 3: Implement controller-owned press records**

```ts
type AgentPress = {
  actionId: string; generation: number; owner: RoutedAgentSlot;
  startedAt: number; released: boolean; transcriptionStarted: boolean;
  timer?: NodeJS.Timeout;
};
```

Capture the route on down, select through `sendToPinnedOwner`, and start transcription only if the record is still current and pressed after 450 ms. Route transcription action down/up using the captured owner. `stop()` cancels every record and releases any started local hold.

- [ ] **Step 4: Change agent actions to delegate lifecycle**

```ts
override onKeyDown(ev: KeyDownEvent): Promise<void> { return this.controller.beginAgentPress(ev.action.id, this.slot); }
override onKeyUp(ev: KeyUpEvent): Promise<void> { return this.controller.endAgentPress(ev.action.id); }
override onWillDisappear(ev: WillDisappearEvent): void { void this.controller.cancelAgentPress(ev.action.id); }
```

- [ ] **Step 5: Add global settings UI**

Extend existing `agent.html` global settings with a mode selector and shortcut controls. Merge the existing settings object before `setGlobalSettings`. `plugin.ts` forwards full `LongPressSettings` updates to the controller.

- [ ] **Step 6: Run focused tests, then commit**

Run: `npm test -- test/long-press.test.ts test/relay.test.ts`

Commit:

```bash
git add src/actions.ts src/controller.ts src/plugin.ts static/property-inspector/agent.html test/long-press.test.ts test/relay.test.ts
git commit -m "feat: add global agent long-press transcription"
```

### Task 3: Local macOS shortcut validation and held-event helper

**Files:**

- Create: `src/macos-shortcut.ts`
- Modify: `src/controller.ts`
- Modify: `static/property-inspector/agent.html`
- Test: `test/macos-shortcut.test.ts`

**Interfaces:**

- Produces `MacosShortcut = { keyCode?: number; modifiers: MacosModifier[] }`.
- Produces `validateMacosShortcut`, `buildShortcutJxa`, `startMacosShortcut`, and `stopMacosShortcut`.

- [ ] **Step 1: Write failing validation and script-generation tests**

```ts
assert.deepEqual(validateMacosShortcut({ modifiers: ["right-option"] }), { modifiers: ["right-option"] });
assert.match(buildShortcutJxa({ modifiers: ["right-option"] }, "down"), /61/);
assert.throws(() => validateMacosShortcut({ keyCode: -1, modifiers: [] }), /keycode/i);
assert.doesNotMatch(buildShortcutJxa({ keyCode: 49, modifiers: ["command"] }, "down"), /user supplied text/i);
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm test -- test/macos-shortcut.test.ts`

- [ ] **Step 3: Implement allowlisted CoreGraphics event generation**

Use `osascript -l JavaScript` with a fixed JXA program that receives only JSON-encoded numeric keycodes/enums. Post individual modifier key-down events first, then the primary key with the computed flags; reverse order for release. Reject macOS shortcut mode on non-darwin platforms. Include a helper-owned 60-second release timeout and make stop idempotent.

- [ ] **Step 4: Wire the custom mode into the controller**

The controller invokes this helper only after local task selection and only for `"macos-shortcut"`. It must not create a relay command. Change/cancel/shutdown paths call the same stop operation.

- [ ] **Step 5: Run focused tests, then commit**

Run: `npm test -- test/macos-shortcut.test.ts test/long-press.test.ts`

Commit:

```bash
git add src/macos-shortcut.ts src/controller.ts static/property-inspector/agent.html test/macos-shortcut.test.ts
git commit -m "feat: support macOS long-press shortcuts"
```

### Task 4: Full verification and manual macOS QA

**Files:**

- Modify only if manual findings require a regression test.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test && npm run check && npm run validate && npm run audit:release`

Expected: all Node tests pass, TypeScript has no errors, Stream Deck package validates, and release audit passes.

- [ ] **Step 2: Package and install the source plugin**

Run: `npm run pack`, then open the produced `com.simeo.codex-deck.streamDeckPlugin`.

- [ ] **Step 3: Perform manual macOS QA**

Verify: quick press switches local and remote-owned tasks; default transcription starts after 450 ms and stops at key-up; Right Option holds/releases AudioPen; a normal chord works; mode change while held releases; Stream Deck/plugin reload does not leave a modifier down; remote disconnect releases remote transcription.

- [ ] **Step 4: Record manual QA outcome in the implementation handoff**

Record the Stream Deck version, macOS version, Accessibility permission result, local/remote host result, and whether any key remained held after each cleanup case. If a manual finding exposes a new behavior, return to the relevant task and add its focused automated regression test before committing a fix.
