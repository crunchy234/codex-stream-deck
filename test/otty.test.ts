import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyOttyManualUnread, applyOttyReadReceipts, focusOttyTab, isOttyForeground, joinOttyAgentSlots, markOttyTabUnread, readOttyReadReceipts, writeOttyReadReceipts } from "../src/otty.js";

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
    { tabId: "tab-1", paneId: "pane-1", title: "one", status: "thinking", selected: false },
    { tabId: "tab-2", paneId: "pane-2b", title: "two", status: "idle", selected: true },
    undefined, undefined, undefined, undefined
  ]);
});

test("marks only a newer, unread completion as complete", () => {
  const slots = [{ tabId: "tab-1", paneId: "pane-1", title: "one", status: "idle" as const, selected: false, completionAt: 101 }];
  const unread = applyOttyReadReceipts(slots, { "pane-1": 100 }, false);
  assert.equal(unread.slots[0]?.status, "complete");
  const read = applyOttyReadReceipts([{ ...slots[0]!, selected: true }], { "pane-1": 100 }, true);
  assert.equal(read.slots[0]?.status, "idle");
  assert.equal(read.receipts["pane-1"], 101);
});

test("maps Otty's unread tab badge to a green Stream Deck state", () => {
  const slots = joinOttyAgentSlots(
    [{ id: "tab-1", index: 0, title: "one", active: false, badge: "unread" }],
    [{ id: "pane-1", tab_id: "tab-1" }],
    [{ version: 1, paneId: "pane-1", pid: 101, sessionId: "a", cwd: "/a", state: "idle", updatedAt: 1 }],
    () => true
  );
  assert.equal(slots[0]?.status, "complete");
});

test("preserves a valid pi context percentage for the existing ring", () => {
  const slots = joinOttyAgentSlots(
    [{ id: "tab-1", index: 0, title: "one", active: false }],
    [{ id: "pane-1", tab_id: "tab-1" }],
    [{ version: 1, paneId: "pane-1", pid: 101, sessionId: "a", cwd: "/a", state: "idle", updatedAt: 1, contextUsedPercent: 42 }],
    () => true
  );
  assert.equal(slots[0]?.contextUsedPercent, 42);
});

test("joins OTTY_PANE_ID records to Otty's p_-prefixed pane ids", () => {
  const slots = joinOttyAgentSlots(
    [{ id: "tab-1", index: 0, title: "one", active: false }],
    [{ id: "p_19f87bf466e_2", tab_id: "tab-1" }],
    [{ version: 1, paneId: "19f87bf466e_2", pid: 101, sessionId: "a", cwd: "/a", state: "idle", updatedAt: 1 }],
    () => true
  );
  assert.equal(slots[0]?.status, "idle");
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

test("persists Otty read receipts and ignores a malformed file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otty-receipts-"));
  const path = join(directory, "receipts.json");
  try {
    assert.deepEqual(await readOttyReadReceipts(path), {});
    await writeOttyReadReceipts({ "pane-1": 101 }, path);
    assert.deepEqual(await readOttyReadReceipts(path), { "pane-1": 101 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recognizes Otty only when it is the foreground app", async () => {
  assert.equal(await isOttyForeground(async () => "Otty\n"), true);
  assert.equal(await isOttyForeground(async () => "Finder\n"), false);
  assert.equal(await isOttyForeground(async () => { throw new Error("denied"); }), false);
});

test("focuses an Otty tab by its stable id", async () => {
  let received: string[] = [];
  await focusOttyTab("tab-2", { run: async (args) => { received = args; return ""; } });
  assert.deepEqual(received, ["tab", "focus", "tab-2"]);
});

test("marks an Otty tab unread by its stable id", async () => {
  let received: string[] = [];
  await markOttyTabUnread("tab-2", { run: async (args) => { received = args; return ""; } });
  assert.deepEqual(received, ["tab", "badge", "--tab", "tab-2", "--kind", "unread"]);
});

test("keeps a Stream Deck unread mark when Otty does not report its badge", () => {
  const slots = [{ tabId: "tab-1", paneId: "pane-1", title: "one", status: "idle" as const, selected: false }];
  assert.equal(applyOttyManualUnread(slots, new Set(["tab-1"]))[0]?.status, "complete");
});
