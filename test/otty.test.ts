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
