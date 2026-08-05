# Otty pi Agent Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing Agent 1–6 Stream Deck keys focus Otty tabs 1–6 and render each tab’s live pi state.

**Architecture:** A user-installed global pi extension records a process-local pi state keyed by Otty’s injected pane ID. A small Otty adapter in the plugin reads those records, joins them to `otty tab list`/`otty pane list`, and supplies the six agent keys when `agentMode` is `otty`. Codex remains the default mode and its actions are unchanged.

**Tech Stack:** TypeScript, Node 20 `fs/promises` and `child_process.execFile`, Otty CLI JSON IPC, Stream Deck SDK, `node:test`.

## Global Constraints

- Do not modify Otty.app, its bundled CLI, or Otty’s private SQLite files.
- Otty mode is macOS-only and applies only to Agent 1–6.
- Otty tab N means zero-based Otty tab index N-1; missing/non-pi/dead records render `empty`.
- Use the supported commands `otty tab list --json`, `otty pane list --json`, and `otty tab focus <tab-id>`.
- Keep Codex the default global `agentMode`; do not alter relay, keycap, usage, or long-press behavior.
- Do not add dependencies.

---

## File structure

| File | Responsibility |
|---|---|
| `extensions/otty-pi-agent-state.ts` | Standalone global pi extension that atomically writes/removes its per-process Otty state record. |
| `src/otty.ts` | Otty CLI JSON parsing, state-record validation, PID liveness filtering, tab/pane join, and tab focus. |
| `src/status.ts` | pi/Otty state to existing `AgentVisualStatus` mapping. |
| `src/types.ts` | `AgentMode` and Otty display-slot types. |
| `src/controller.ts` | Select Codex or Otty agent source; Otty presses focus a tab and bypass Codex long press. |
| `src/plugin.ts` | Propagate the global `agentMode` setting. |
| `static/property-inspector/agent.html` | Global Agent source selector and Otty-mode copy. |
| `scripts/build.mjs` | Package the extension template with the Stream Deck plugin. |
| `README.md` | One-time pi extension installation and Otty-mode setup. |
| `test/otty.test.ts` | Adapter and join behavior. |
| `test/status.test.ts` | Otty pi-state rendering mapping. |
| `test/ios-project.test.ts` | Packaged inspector/template regression assertions. |

### Task 1: Ship the pi state publisher

**Files:**
- Create: `extensions/otty-pi-agent-state.ts`
- Modify: `scripts/build.mjs`
- Modify: `test/ios-project.test.ts`

**Interfaces:**
- Produces one JSON file at `~/Library/Application Support/CodexDeck/otty-pi/<pid>.json`:
  ```ts
  type PiOttyStateRecord = {
    version: 1; paneId: string; pid: number; sessionId: string; cwd: string;
    state: "processing" | "idle" | "awaiting"; updatedAt: number;
  };
  ```
- Consumed by `readOttyAgentSlots()` in Task 2.

- [ ] **Step 1: Write the failing package regression test**

  Add this test to `test/ios-project.test.ts`:

  ```ts
  test("the packaged plugin includes the standalone pi Otty state extension", async () => {
    const source = await readFile(new URL("../extensions/otty-pi-agent-state.ts", import.meta.url), "utf8");
    const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
    assert.match(source, /OTTY_PANE_ID/);
    assert.match(source, /agent_settled/);
    assert.match(source, /otty-pi/);
    assert.match(build, /otty-pi-agent-state\.ts/);
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx tsx --test test/ios-project.test.ts`

  Expected: FAIL because `extensions/otty-pi-agent-state.ts` does not exist.

- [ ] **Step 3: Add the standalone extension and package it**

  Create `extensions/otty-pi-agent-state.ts` with this complete extension. It intentionally has no pi-package import so it can be copied directly to `~/.pi/agent/extensions/`.

  ```ts
  import { mkdir, rename, rm, writeFile } from "node:fs/promises";
  import { homedir } from "node:os";
  import { join } from "node:path";

  type State = "processing" | "idle" | "awaiting";
  const directory = join(homedir(), "Library", "Application Support", "CodexDeck", "otty-pi");
  const path = join(directory, `${process.pid}.json`);

  async function publish(state: State, ctx: any): Promise<void> {
    const paneId = process.env.OTTY_PANE_ID;
    if (!paneId) return;
    const sessionId = String(ctx.sessionManager.getSessionId());
    const value = JSON.stringify({ version: 1, paneId, pid: process.pid, sessionId, cwd: String(ctx.cwd), state, updatedAt: Date.now() }) + "\n";
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${Date.now()}.tmp`;
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }

  export default function (pi: any): void {
    pi.on("session_start", (_event: unknown, ctx: any) => publish("idle", ctx).catch(() => {}));
    pi.on("before_agent_start", (_event: unknown, ctx: any) => publish("processing", ctx).catch(() => {}));
    pi.on("tool_call", (_event: unknown, ctx: any) => publish("processing", ctx).catch(() => {}));
    pi.on("agent_settled", (_event: unknown, ctx: any) => publish("idle", ctx).catch(() => {}));
    pi.on("session_shutdown", () => rm(path, { force: true }).catch(() => {}));
  }
  ```

  In `scripts/build.mjs`, create `dist/com.simeo.codex-deck.sdPlugin/extensions` beside the existing property-inspector directory and add this copy after the inspector copies:

  ```ts
  await mkdir(resolve(output, "extensions"), { recursive: true });
  await cp(resolve("extensions/otty-pi-agent-state.ts"), resolve(output, "extensions/otty-pi-agent-state.ts"));
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx tsx --test test/ios-project.test.ts`

  Expected: PASS, including the new template assertions.

- [ ] **Step 5: Commit**

  ```bash
  git add extensions/otty-pi-agent-state.ts scripts/build.mjs test/ios-project.test.ts
  git commit -m "feat(otty): ship pi state extension"
  ```

### Task 2: Build the Otty adapter test-first

**Files:**
- Create: `src/otty.ts`
- Create: `test/otty.test.ts`
- Modify: `src/status.ts`
- Modify: `test/status.test.ts`

**Interfaces:**
- Consumes the state-record shape from Task 1.
- Produces:
  ```ts
  export type OttyAgentSlot = {
    tabId: string; title: string; status: AgentVisualStatus; selected: boolean;
  };
  export async function readOttyAgentSlots(options?: OttyOptions): Promise<Array<OttyAgentSlot | undefined>>;
  export async function focusOttyTab(tabId: string, options?: OttyOptions): Promise<void>;
  export function visualStatusFromOtty(state: string): AgentVisualStatus;
  ```

- [ ] **Step 1: Write failing adapter tests**

  Create `test/otty.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import { focusOttyTab, joinOttyAgentSlots } from "../src/otty.js";

  const tabs = [
    { id: "tab-1", index: 0, title: "one", active: false },
    { id: "tab-2", index: 1, title: "two", active: true },
    { id: "tab-3", index: 2, title: "three", active: false }
  ];
  const panes = [
    { id: "pane-1", tab_id: "tab-1" },
    { id: "pane-2a", tab_id: "tab-2" },
    { id: "pane-2b", tab_id: "tab-2" },
    { id: "pane-3", tab_id: "tab-3" }
  ];

  test("maps Otty tab indexes zero through five to agent keys one through six", () => {
    const slots = joinOttyAgentSlots(tabs, panes, [
      { version: 1, paneId: "pane-1", pid: 101, sessionId: "a", cwd: "/a", state: "processing", updatedAt: 1 },
      { version: 1, paneId: "pane-2b", pid: 102, sessionId: "b", cwd: "/b", state: "idle", updatedAt: 1 }
    ], (pid) => pid >= 101);
    assert.deepEqual(slots, [
      { tabId: "tab-1", title: "one", status: "thinking", selected: false },
      { tabId: "tab-2", title: "two", status: "complete", selected: true },
      undefined, undefined, undefined, undefined
    ]);
  });

  test("ignores stale, non-pi, and tabs after the sixth", () => {
    const slots = joinOttyAgentSlots(
      [...tabs, ...Array.from({ length: 5 }, (_, offset) => ({ id: `extra-${offset}`, index: offset + 3, title: "extra", active: false }))],
      panes,
      [{ version: 1, paneId: "pane-3", pid: 100, sessionId: "dead", cwd: "/dead", state: "awaiting", updatedAt: 1 }],
      () => false
    );
    assert.deepEqual(slots, [undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  test("focuses an Otty tab by its stable id", async () => {
    let received: string[] = [];
    await focusOttyTab("tab-2", { run: async (args) => { received = args; return ""; } });
    assert.deepEqual(received, ["tab", "focus", "tab-2"]);
  });
  ```

  Add these assertions to `test/status.test.ts`:

  ```ts
  assert.equal(visualStatusFromOtty("processing"), "thinking");
  assert.equal(visualStatusFromOtty("idle"), "complete");
  assert.equal(visualStatusFromOtty("awaiting"), "input");
  assert.equal(visualStatusFromOtty("unknown"), "empty");
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx tsx --test test/otty.test.ts test/status.test.ts`

  Expected: FAIL with missing `../src/otty.js` and missing `visualStatusFromOtty`.

- [ ] **Step 3: Implement the minimal adapter**

  In `src/status.ts`, add:

  ```ts
  export function visualStatusFromOtty(state: string): AgentVisualStatus {
    if (state === "processing") return "thinking";
    if (state === "idle") return "complete";
    if (state === "awaiting") return "input";
    return "empty";
  }
  ```

  Create `src/otty.ts`. Parse only the fields used below; reject every malformed record and never read Otty SQLite state:

  ```ts
  import { execFile } from "node:child_process";
  import { readdir, readFile } from "node:fs/promises";
  import { join } from "node:path";
  import { promisify } from "node:util";
  import { codexDeckStateRoot } from "./codex-deck-paths.js";
  import { visualStatusFromOtty } from "./status.js";
  import type { AgentVisualStatus } from "./types.js";

  const execFileAsync = promisify(execFile);
  const defaultCli = "/Applications/Otty.app/Contents/MacOS/otty-cli";
  export type OttyAgentSlot = { tabId: string; title: string; status: AgentVisualStatus; selected: boolean };
  type Tab = { id: string; index: number; title: string; active: boolean };
  type Pane = { id: string; tab_id: string };
  type PiRecord = { version: 1; paneId: string; pid: number; sessionId: string; cwd: string; state: string; updatedAt: number };
  export type OttyOptions = { cli?: string; stateDirectory?: string; run?: (args: string[]) => Promise<string>; alive?: (pid: number) => boolean };

  const validRecord = (value: unknown): value is PiRecord => {
    const item = value as Partial<PiRecord> | null;
    return item?.version === 1 && typeof item.paneId === "string" && typeof item.pid === "number"
      && Number.isInteger(item.pid) && item.pid > 0 && typeof item.sessionId === "string"
      && typeof item.cwd === "string" && typeof item.state === "string" && typeof item.updatedAt === "number";
  };

  export function joinOttyAgentSlots(tabs: Tab[], panes: Pane[], records: PiRecord[], alive: (pid: number) => boolean): Array<OttyAgentSlot | undefined> {
    const panesByTab = new Map<string, Set<string>>();
    for (const pane of panes) {
      let tabPanes = panesByTab.get(pane.tab_id);
      if (!tabPanes) { tabPanes = new Set(); panesByTab.set(pane.tab_id, tabPanes); }
      tabPanes.add(pane.id);
    }
    const liveByPane = new Map<string, PiRecord>();
    for (const record of records.filter((record) => alive(record.pid))) {
      const current = liveByPane.get(record.paneId);
      if (!current || current.updatedAt < record.updatedAt) liveByPane.set(record.paneId, record);
    }
    const slots: Array<OttyAgentSlot | undefined> = Array.from({ length: 6 });
    for (const tab of tabs) {
      if (tab.index < 0 || tab.index >= 6) continue;
      const record = [...(panesByTab.get(tab.id) ?? [])].map((paneId) => liveByPane.get(paneId)).find(Boolean);
      if (record) slots[tab.index] = { tabId: tab.id, title: tab.title || `Tab ${tab.index + 1}`, status: visualStatusFromOtty(record.state), selected: tab.active };
    }
    return slots;
  }

  export async function readOttyAgentSlots(options: OttyOptions = {}): Promise<Array<OttyAgentSlot | undefined>> {
    if (process.platform !== "darwin") return [];
    const cli = options.cli ?? process.env.OTTY_CLI ?? defaultCli;
    const run = options.run ?? (async (args) => (await execFileAsync(cli, args, { timeout: 3000 })).stdout);
    const parse = <T>(text: string): T => (JSON.parse(text) as { data: T }).data;
    const [tabs, panes] = await Promise.all([run(["tab", "list", "--json"]).then(parse<Tab[]>), run(["pane", "list", "--json"]).then(parse<Pane[]>)]);
    const directory = options.stateDirectory ?? join(codexDeckStateRoot(), "otty-pi");
    const records = await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json")).map(async (name) => {
      try { const value: unknown = JSON.parse(await readFile(join(directory, name), "utf8")); return validRecord(value) ? value : null; } catch { return null; }
    }));
    const alive = options.alive ?? ((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    return joinOttyAgentSlots(tabs, panes, records.filter((record): record is PiRecord => record != null), alive);
  }

  export async function focusOttyTab(tabId: string, options: OttyOptions = {}): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Otty agent tabs require macOS.");
    const cli = options.cli ?? process.env.OTTY_CLI ?? defaultCli;
    if (options.run) { await options.run(["tab", "focus", tabId]); return; }
    await execFileAsync(cli, ["tab", "focus", tabId], { timeout: 3000 });
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx tsx --test test/otty.test.ts test/status.test.ts && npm run check`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/otty.ts src/status.ts test/otty.test.ts test/status.test.ts
  git commit -m "feat(otty): read pi agent tab state"
  ```

### Task 3: Route only Agent 1–6 through Otty mode

**Files:**
- Modify: `src/types.ts`
- Modify: `src/controller.ts`
- Modify: `src/plugin.ts`
- Modify: `static/property-inspector/agent.html`
- Modify: `test/ios-project.test.ts`

**Interfaces:**
- Adds `export type AgentMode = "codex" | "otty"` to `src/types.ts`.
- Adds `setAgentMode(mode: AgentMode | undefined): void` to `DeckController`.
- In Otty mode `beginAgentPress(actionId, slot)` focuses `this.ottySlots[slot]?.tabId` and returns; `endAgentPress()` is a no-op for that press.

- [ ] **Step 1: Write the failing source-switch test**

  Add to `test/ios-project.test.ts`:

  ```ts
  test("agent inspector exposes an opt-in Otty source", async () => {
    const inspector = await readFile(new URL("../static/property-inspector/agent.html", import.meta.url), "utf8");
    const plugin = await readFile(new URL("../src/plugin.ts", import.meta.url), "utf8");
    assert.match(inspector, /id="agent-mode"/);
    assert.match(inspector, /value="otty"/);
    assert.match(plugin, /setAgentMode/);
  });
  ```

- [ ] **Step 2: Run tests to verify failure**

  Run: `npx tsx --test test/ios-project.test.ts`

  Expected: FAIL because no Otty setting exists.

- [ ] **Step 3: Implement the smallest source switch**

  In `src/types.ts`, add:

  ```ts
  export type AgentMode = "codex" | "otty";
  ```

  In `src/controller.ts` import `focusOttyTab`, `readOttyAgentSlots`, `OttyAgentSlot`, and `AgentMode`; add:

  ```ts
  private agentMode: AgentMode = "codex";
  private ottySlots: Array<OttyAgentSlot | undefined> = [];

  setAgentMode(mode: AgentMode | undefined): void {
    const next: AgentMode = mode === "otty" ? "otty" : "codex";
    if (next === this.agentMode) return;
    this.agentMode = next;
    void this.refresh();
  }
  ```

  In `start()`, assign the normalized saved mode directly after `getGlobalSettings` (do not call `setAgentMode()` before startup finishes):

  ```ts
  this.agentMode = settings.agentMode === "otty" ? "otty" : "codex";
  ```

  At the top of `refreshOnce()`, branch only the agent source:

  ```ts
  if (this.agentMode === "otty") {
    try { this.ottySlots = await readOttyAgentSlots(); this.lastError = ""; }
    catch (error) {
      this.ottySlots = [];
      const message = String(error);
      if (message !== this.lastError) streamDeck.logger.warn(`Otty agent tabs unavailable: ${message}`);
      this.lastError = message;
    }
    await this.renderAll();
    return;
  }
  ```

  At the start of `beginAgentPress()` focus only the selected Otty slot:

  ```ts
  if (this.agentMode === "otty") {
    const tab = this.ottySlots[slot];
    if (tab) await focusOttyTab(tab.tabId);
    return;
  }
  ```

  At the start of `endAgentPress()` add `if (this.agentMode === "otty") return;`. In `renderAgent()`, select the Otty slot when the mode is Otty and render it with existing `renderAgentKey(slot, title, status, selected, ...)`; missing slots use title `Not assigned` and status `empty`. Do not call Codex host-health, host-badge, or context-ring logic for Otty slots.

  In `src/plugin.ts`, extend the settings shape and forward it:

  ```ts
  streamDeck.settings.onDidReceiveGlobalSettings<{ showContextRings?: boolean; longPress?: LongPressSettings; agentMode?: "codex" | "otty" }>((event) => {
    controller.setContextRingVisibility(event.settings.showContextRings !== false);
    controller.setLongPressSettings(event.settings.longPress);
    controller.setAgentMode(event.settings.agentMode);
  });
  ```

  Also read `agentMode` in `start()` and call `this.setAgentMode(settings.agentMode)` after reading global settings.

  In `static/property-inspector/agent.html`, add this source selector before context rings:

  ```html
  <label><span>Agent source</span><select id="agent-mode"><option value="codex">Codex Micro</option><option value="otty">Otty pi tabs</option></select></label>
  <p>Otty mode maps Agent 1–6 to Otty tabs 1–6. Other keys remain Codex controls.</p>
  ```

  In the global-settings receive handler, set `agent-mode` from `globalSettings.agentMode ?? "codex"`. Add a change listener that writes exactly:

  ```js
  globalSettings = { ...globalSettings, agentMode: document.getElementById("agent-mode").value };
  sendGlobalSettings();
  ```

- [ ] **Step 4: Run tests and type check**

  Run: `npx tsx --test test/ios-project.test.ts && npm run check && npm test`

  Expected: PASS. Existing Codex tests remain green because `agentMode` defaults to `codex`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/types.ts src/controller.ts src/plugin.ts static/property-inspector/agent.html test/ios-project.test.ts
  git commit -m "feat(otty): map agent keys to pi tabs"
  ```

### Task 4: Package documentation and validate the artifact

**Files:**
- Modify: `README.md`
- Modify: `static/manifest.json`
- Test: `test/ios-project.test.ts`

**Interfaces:**
- Users copy `extensions/otty-pi-agent-state.ts` from the plugin package to `~/.pi/agent/extensions/otty-pi-agent-state.ts`, restart or `/reload` pi, then select **Otty pi tabs** in any Agent key’s inspector.

- [ ] **Step 1: Write the failing documentation/package test**

  Add to `test/ios-project.test.ts`:

  ```ts
  test("manifest and README describe Otty pi agent tabs", async () => {
    const [manifest, readme] = await Promise.all([
      readFile(new URL("../static/manifest.json", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8")
    ]);
    assert.match(manifest, /Otty pi tabs/);
    assert.match(readme, /otty-pi-agent-state\.ts/);
    assert.match(readme, /Agent source/);
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx tsx --test test/ios-project.test.ts`

  Expected: FAIL because the manifest and README do not mention the Otty mode/template.

- [ ] **Step 3: Document the one-time setup and update agent tooltips**

  Change the six agent tooltips in `static/manifest.json` to say they open the selected Codex Micro slot **or** Otty pi tab in Otty mode. Add one concise README section after Features:

  ```markdown
  ### Otty pi agent tabs (macOS)

  To map **Agent 1–6** to Otty tabs 1–6, copy the packaged `extensions/otty-pi-agent-state.ts` to `~/.pi/agent/extensions/`, run `/reload` (or restart pi), then set **Agent source** to **Otty pi tabs** in an Agent key’s property inspector. Pi sessions outside Otty and tabs without pi render as empty. This integration uses Otty's supported CLI; it does not modify Otty.app.
  ```

- [ ] **Step 4: Run complete verification**

  Run:

  ```bash
  npm run check
  npm test
  npm run build
  streamdeck validate dist/com.simeo.codex-deck.sdPlugin
  test -f dist/com.simeo.codex-deck.sdPlugin/extensions/otty-pi-agent-state.ts
  ```

  Expected: every command exits 0 and the packaged extension exists.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md static/manifest.json test/ios-project.test.ts
  git commit -m "docs(otty): explain pi tab setup"
  ```
