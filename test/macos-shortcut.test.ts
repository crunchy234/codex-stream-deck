import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShortcutJxa, validateMacosShortcut
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
