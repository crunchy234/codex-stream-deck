import assert from "node:assert/strict";
import test from "node:test";
import { readPinnedSidebarSlots } from "../src/codex-sidebar.js";

function row(key: string, title: string, status?: object) {
  return {
    getAttribute(name: string) { return ({
      "data-app-action-sidebar-thread-id": key,
      "data-app-action-sidebar-thread-title": title,
      "data-app-action-sidebar-thread-active": "false"
    } as Record<string, string>)[name] ?? null; },
    __reactFiber$test: { memoizedProps: { statusState: status }, return: null }
  };
}
const native = Array.from({length: 6}, (_, id) => ({id, threadKey: `old-${id}`, title: "Old pin", status: "idle", selected: false}));
test("Pinned mode follows live sidebar order, titles and status instead of stale native Micro slots", () => {
  const rows = [row("current-1", "First", {type: "loading"}), row("current-2", "Second", {type: "idle", unread: true}), row("current-1", "First")];
  const document = { querySelectorAll: () => rows } as unknown as Document;
  const slots = readPinnedSidebarSlots(document, native);
  assert.deepEqual(slots?.map(s => s.threadKey), ["current-1", "current-2", null, null, null, null]);
  assert.equal(slots?.[0]?.title, "First");
  assert.equal(slots?.[0]?.status, "working");
  assert.equal(slots?.[1]?.status, "unread");
});
test("hidden or older sidebars keep native slots as the fallback", () => {
  assert.equal(readPinnedSidebarSlots({querySelectorAll: () => []} as unknown as Document, native), undefined);
});
test("matching slots retain native activity metadata without inheriting an unrelated task's status", () => {
  const rows = [row("old-2", "Renamed")];
  const slots = readPinnedSidebarSlots({querySelectorAll: () => rows} as unknown as Document, native.map(s => ({...s, activityAt: 42})));
  assert.equal(slots?.[0]?.activityAt, 42);
  assert.equal(slots?.[0]?.title, "Renamed");
});
