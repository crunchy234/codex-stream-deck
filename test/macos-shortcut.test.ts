import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShortcutEventPlan, buildShortcutJxa, createMacosShortcutHandle,
  validateMacosShortcut
} from "../src/macos-shortcut.js";

test("accepts a modifier-only Right Option shortcut and emits its native key code", () => {
  const shortcut = validateMacosShortcut({ modifiers: ["right-option"] });

  assert.deepEqual(shortcut, { modifiers: ["right-option"] });
  assert.match(buildShortcutJxa(shortcut, "down"), /61/);
});

test("rejects invalid macOS virtual key codes before launching automation", () => {
  assert.throws(
    () => validateMacosShortcut({ keyCode: -1, modifiers: [] }),
    /keycode/i
  );
});

test("uses a static JXA program instead of embedding user-provided shortcut text", () => {
  const source = buildShortcutJxa({ keyCode: 49, modifiers: ["left-command"] }, "down");

  assert.doesNotMatch(source, /user supplied text/i);
  assert.match(source, /JSON\.parse/);
});

test("posts every modifier with cumulative flags and unwinds them in reverse", () => {
  const shortcut: { keyCode: number; modifiers: ("left-command" | "right-option")[] } = {
    keyCode: 49,
    modifiers: ["left-command", "right-option"]
  };

  assert.deepEqual(buildShortcutEventPlan(shortcut, "down"), [
    { keyCode: 55, down: true, flags: 1_048_576 },
    { keyCode: 61, down: true, flags: 1_572_864 },
    { keyCode: 49, down: true, flags: 1_572_864 }
  ]);
  assert.deepEqual(buildShortcutEventPlan(shortcut, "up"), [
    { keyCode: 49, down: false, flags: 1_572_864 },
    { keyCode: 61, down: false, flags: 1_572_864 },
    { keyCode: 55, down: false, flags: 1_048_576 }
  ]);
});

test("sets Option flags on both events for a modifier-only Right Option shortcut", () => {
  const shortcut: { modifiers: "right-option"[] } = { modifiers: ["right-option"] };

  assert.deepEqual(buildShortcutEventPlan(shortcut, "down"), [
    { keyCode: 61, down: true, flags: 524_288 }
  ]);
  assert.deepEqual(buildShortcutEventPlan(shortcut, "up"), [
    { keyCode: 61, down: false, flags: 524_288 }
  ]);
});

test("keeps the Option flag through both side-specific Option releases", () => {
  const shortcut: { keyCode: number; modifiers: ("left-option" | "right-option")[] } = {
    keyCode: 49,
    modifiers: ["left-option", "right-option"]
  };

  assert.deepEqual(buildShortcutEventPlan(shortcut, "down"), [
    { keyCode: 58, down: true, flags: 524_288 },
    { keyCode: 61, down: true, flags: 524_288 },
    { keyCode: 49, down: true, flags: 524_288 }
  ]);
  assert.deepEqual(buildShortcutEventPlan(shortcut, "up"), [
    { keyCode: 49, down: false, flags: 524_288 },
    { keyCode: 61, down: false, flags: 524_288 },
    { keyCode: 58, down: false, flags: 524_288 }
  ]);
});

test("returns one shared in-flight stop promise to concurrent callers", async () => {
  let releaseStopFile: (() => void) | undefined;
  let writes = 0;
  const handle = createMacosShortcutHandle(
    async () => { writes += 1; },
    new Promise<void>((resolve) => { releaseStopFile = resolve; })
  );

  const first = handle.stop();
  const second = handle.stop();
  assert.strictEqual(first, second);
  assert.equal(writes, 1);

  releaseStopFile?.();
  await Promise.all([first, second]);
});
