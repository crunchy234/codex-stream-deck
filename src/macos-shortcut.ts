import { randomInt } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";

export type MacosModifier =
  | "left-option" | "right-option" | "left-command" | "right-command"
  | "left-control" | "right-control" | "left-shift" | "right-shift";

export type MacosShortcut = { keyCode?: number; modifiers?: MacosModifier[] };
export type ValidMacosShortcut = { keyCode?: number; modifiers: MacosModifier[] };
export type MacosShortcutHandle = { stop(): Promise<void> };
export type MacosShortcutEvent = { keyCode: number; down: boolean; flags: number };

const LEASE_MS = 60_000;
const KEY_CODE_MIN = 0;
const KEY_CODE_MAX = 127;

const modifierKeyCodes: Record<MacosModifier, number> = {
  "left-command": 55,
  "right-command": 54,
  "left-shift": 56,
  "right-shift": 60,
  "left-option": 58,
  "right-option": 61,
  "left-control": 59,
  "right-control": 62
};

const modifierFlags: Record<MacosModifier, number> = {
  "left-command": 1_048_576,
  "right-command": 1_048_576,
  "left-shift": 131_072,
  "right-shift": 131_072,
  "left-option": 524_288,
  "right-option": 524_288,
  "left-control": 262_144,
  "right-control": 262_144
};

const modifierNames = new Set<MacosModifier>(Object.keys(modifierKeyCodes) as MacosModifier[]);

/**
 * Ensures persisted settings can only encode known virtual key codes and the
 * explicitly supported left/right modifier keys. It deliberately returns no
 * text that could later become part of an automation program.
 */
export function validateMacosShortcut(shortcut: MacosShortcut): ValidMacosShortcut {
  if (!shortcut || typeof shortcut !== "object" || Array.isArray(shortcut)) {
    throw new Error("A macOS shortcut must be an object.");
  }
  if (shortcut.keyCode != null && (!Number.isInteger(shortcut.keyCode)
    || shortcut.keyCode < KEY_CODE_MIN || shortcut.keyCode > KEY_CODE_MAX)) {
    throw new Error("The macOS shortcut keycode must be an integer from 0 through 127.");
  }
  const modifiers = shortcut.modifiers ?? [];
  if (!Array.isArray(modifiers) || modifiers.some((modifier) => !modifierNames.has(modifier))) {
    throw new Error("The macOS shortcut contains an unsupported modifier.");
  }
  const uniqueModifiers = [...new Set(modifiers)];
  if (shortcut.keyCode == null && uniqueModifiers.length === 0) {
    throw new Error("A macOS shortcut needs a keycode or modifier.");
  }
  return {
    ...(shortcut.keyCode == null ? {} : { keyCode: shortcut.keyCode }),
    modifiers: uniqueModifiers
  };
}

type ShortcutPhase = "down" | "up";

/**
 * The exact CoreGraphics key-event sequence. Each modifier event carries the
 * active flags at that point so side-specific modifiers are visible even when
 * the shortcut contains no primary key.
 */
export function buildShortcutEventPlan(shortcut: MacosShortcut, phase: ShortcutPhase): MacosShortcutEvent[] {
  const validated = validateMacosShortcut(shortcut);
  const modifiers = validated.modifiers.map((modifier) => ({
    keyCode: modifierKeyCodes[modifier],
    flag: modifierFlags[modifier]
  }));
  const fullFlags = modifiers.reduce((flags, modifier) => flags | modifier.flag, 0);

  if (phase === "down") {
    let activeFlags = 0;
    const events = modifiers.map((modifier) => {
      activeFlags |= modifier.flag;
      return { keyCode: modifier.keyCode, down: true, flags: activeFlags };
    });
    if (validated.keyCode != null) {
      events.push({ keyCode: validated.keyCode, down: true, flags: fullFlags });
    }
    return events;
  }

  let activeFlags = fullFlags;
  const activeFlagCounts = new Map<number, number>();
  for (const modifier of modifiers) {
    activeFlagCounts.set(modifier.flag, (activeFlagCounts.get(modifier.flag) ?? 0) + 1);
  }
  const events: MacosShortcutEvent[] = [];
  if (validated.keyCode != null) {
    events.push({ keyCode: validated.keyCode, down: false, flags: activeFlags });
  }
  for (const modifier of [...modifiers].reverse()) {
    events.push({ keyCode: modifier.keyCode, down: false, flags: activeFlags });
    const remainingCount = (activeFlagCounts.get(modifier.flag) ?? 1) - 1;
    if (remainingCount === 0) {
      activeFlagCounts.delete(modifier.flag);
      activeFlags &= ~modifier.flag;
    } else {
      activeFlagCounts.set(modifier.flag, remainingCount);
    }
  }
  return events;
}

/**
 * A fixed JXA program. Shortcut details are supplied separately as JSON with
 * only numeric key codes, so a setting can never be interpreted as script.
 */
export function buildShortcutJxa(shortcut: MacosShortcut, _phase: ShortcutPhase): string {
  validateMacosShortcut(shortcut);
  return `ObjC.import('CoreGraphics');
const argv = $.NSProcessInfo.processInfo.arguments;
const payload = JSON.parse(ObjC.unwrap(argv.objectAtIndex(argv.count - 2)));
const phase = ObjC.unwrap(argv.objectAtIndex(argv.count - 1));
const modifierFlags = {54: 1048576, 55: 1048576, 56: 131072, 60: 131072, 58: 524288, 61: 524288, 59: 262144, 62: 262144};
const isKeyCode = (code) => Number.isInteger(code) && code >= 0 && code <= 127;
if (!payload || !Array.isArray(payload.modifiers) || !payload.modifiers.every((code) => Object.prototype.hasOwnProperty.call(modifierFlags, code)) || (payload.keyCode !== undefined && !isKeyCode(payload.keyCode)) || (phase !== 'down' && phase !== 'up')) throw new Error('Invalid numeric shortcut payload.');
const flags = payload.modifiers.reduce((value, code) => value | modifierFlags[code], 0);
const post = (code, down, eventFlags) => { const event = $.CGEventCreateKeyboardEvent(null, code, down); $.CGEventSetFlags(event, eventFlags); $.CGEventPost($.kCGHIDEventTap, event); };
if (phase === 'down') {
  let activeFlags = 0;
  payload.modifiers.forEach((code) => { activeFlags |= modifierFlags[code]; post(code, true, activeFlags); });
  if (payload.keyCode !== undefined) post(payload.keyCode, true, flags);
} else {
  if (payload.keyCode !== undefined) post(payload.keyCode, false, flags);
  let activeFlags = flags;
  const activeFlagCounts = payload.modifiers.reduce((counts, code) => { const flag = modifierFlags[code]; counts[flag] = (counts[flag] || 0) + 1; return counts; }, {});
  [...payload.modifiers].reverse().forEach((code) => { const flag = modifierFlags[code]; post(code, false, activeFlags); if (--activeFlagCounts[flag] === 0) activeFlags &= ~flag; });
}`;
}

function buildHeldShortcutJxa(shortcut: MacosShortcut): string {
  validateMacosShortcut(shortcut);
  return `ObjC.import('Foundation');
ObjC.import('CoreGraphics');
const argv = $.NSProcessInfo.processInfo.arguments;
const payload = JSON.parse(ObjC.unwrap(argv.objectAtIndex(argv.count - 1)));
const modifierFlags = {54: 1048576, 55: 1048576, 56: 131072, 60: 131072, 58: 524288, 61: 524288, 59: 262144, 62: 262144};
const isKeyCode = (code) => Number.isInteger(code) && code >= 0 && code <= 127;
if (!payload || !Number.isSafeInteger(payload.token) || !Array.isArray(payload.modifiers) || !payload.modifiers.every((code) => Object.prototype.hasOwnProperty.call(modifierFlags, code)) || (payload.keyCode !== undefined && !isKeyCode(payload.keyCode))) throw new Error('Invalid numeric shortcut payload.');
const flags = payload.modifiers.reduce((value, code) => value | modifierFlags[code], 0);
const post = (code, down, eventFlags) => { const event = $.CGEventCreateKeyboardEvent(null, code, down); $.CGEventSetFlags(event, eventFlags); $.CGEventPost($.kCGHIDEventTap, event); };
const release = () => { if (payload.keyCode !== undefined) post(payload.keyCode, false, flags); let activeFlags = flags; const activeFlagCounts = payload.modifiers.reduce((counts, code) => { const flag = modifierFlags[code]; counts[flag] = (counts[flag] || 0) + 1; return counts; }, {}); [...payload.modifiers].reverse().forEach((code) => { const flag = modifierFlags[code]; post(code, false, activeFlags); if (--activeFlagCounts[flag] === 0) activeFlags &= ~flag; }); };
let activeFlags = 0;
payload.modifiers.forEach((code) => { activeFlags |= modifierFlags[code]; post(code, true, activeFlags); });
if (payload.keyCode !== undefined) post(payload.keyCode, true, flags);
const stopFile = '/tmp/codex-stream-deck-shortcut-' + payload.token + '.stop';
const deadline = Date.now() + ${LEASE_MS};
while (Date.now() < deadline && !$.NSFileManager.defaultManager.fileExistsAtPath(stopFile)) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
}
release();`;
}

function numericPayload(shortcut: ValidMacosShortcut, token: number): string {
  return JSON.stringify({
    ...(shortcut.keyCode == null ? {} : { keyCode: shortcut.keyCode }),
    modifiers: shortcut.modifiers.map((modifier) => modifierKeyCodes[modifier]),
    token
  });
}

function waitForChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
}

/**
 * Coalesces all release paths behind one promise so a reload, timeout, and
 * key-up can safely race without letting any caller continue before release.
 */
export function createMacosShortcutHandle(
  requestStop: () => Promise<void>,
  done: Promise<void>
): MacosShortcutHandle {
  let stopPromise: Promise<void> | undefined;
  return {
    stop(): Promise<void> {
      stopPromise ??= requestStop().then(() => done);
      return stopPromise;
    }
  };
}

/**
 * Starts a detached helper that holds the event itself. If the plugin exits
 * without calling stop, the helper releases the keys after the fixed lease.
 */
export async function startMacosShortcut(shortcut: MacosShortcut): Promise<MacosShortcutHandle> {
  const validated = validateMacosShortcut(shortcut);
  if (process.platform !== "darwin") {
    throw new Error("macOS shortcuts are only available on macOS.");
  }

  const token = randomInt(1, 2 ** 31);
  const stopFile = `/tmp/codex-stream-deck-shortcut-${token}.stop`;
  await rm(stopFile, { force: true });
  const child = spawn("/usr/bin/osascript", [
    "-l", "JavaScript", "-e", buildHeldShortcutJxa(validated), numericPayload(validated, token)
  ], { detached: true, stdio: "ignore" });
  const done = waitForChild(child).finally(() => rm(stopFile, { force: true }));
  child.unref();

  let leaseTimer: NodeJS.Timeout | undefined;
  const handle = createMacosShortcutHandle(async () => {
    if (leaseTimer) clearTimeout(leaseTimer);
    await writeFile(stopFile, "", { flag: "w" });
  }, done);
  leaseTimer = setTimeout(() => { void handle.stop().catch(() => undefined); }, LEASE_MS);
  leaseTimer.unref();
  return handle;
}

/** Releases a started helper exactly once; safe for every cancellation path. */
export async function stopMacosShortcut(handle: MacosShortcutHandle | undefined): Promise<void> {
  await handle?.stop();
}
