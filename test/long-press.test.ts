import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentPressMachine, DeckController, normalizeLongPressSettings,
  type AgentPressClock, type AgentPressOwner
} from "../src/controller.js";

type Call = ["select" | "down" | "up", string, string];

class FakeClock implements AgentPressClock {
  private time = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number { return this.time; }

  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const id = ++this.nextId;
    this.timers.set(id, { dueAt: this.time + delay, callback });
    return id as unknown as NodeJS.Timeout;
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    this.timers.delete(timer as unknown as number);
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.time)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

const owner: AgentPressOwner = {
  id: 0,
  sourceSlot: 3,
  threadKey: "00000000-0000-4000-8000-000000000001",
  title: "Task",
  status: "idle",
  selected: false,
  observedAt: 1,
  host: { hostId: "host-a", hostName: "Mac", platform: "darwin" }
};

function createMachine(settings = normalizeLongPressSettings(undefined)) {
  const calls: Call[] = [];
  const clock = new FakeClock();
  const machine = new AgentPressMachine({
    clock,
    settings: () => settings,
    select: async (assignment) => { calls.push(["select", assignment.host.hostId, assignment.threadKey!]); },
    transcription: async (assignment, act) => {
      calls.push([act === 1 ? "down" : "up", assignment.host.hostId, assignment.threadKey!]);
    },
    reportError: (error) => { throw error; }
  });
  return { calls, clock, machine };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("quick release selects once and never starts transcription", async () => {
  const { calls, clock, machine } = createMachine();
  await machine.down("action-a", owner);
  clock.advance(449);
  await machine.up("action-a");
  assert.deepEqual(calls, [["select", owner.host.hostId, owner.threadKey!]]);
});

test("selection resolving after key-up cannot start transcription", async () => {
  const clock = new FakeClock();
  const calls: Call[] = [];
  let resolveSelection!: () => void;
  const selection = new Promise<void>((resolve) => { resolveSelection = resolve; });
  const machine = new AgentPressMachine({
    clock,
    settings: () => normalizeLongPressSettings(undefined),
    select: async (assignment) => {
      calls.push(["select", assignment.host.hostId, assignment.threadKey!]);
      await selection;
    },
    transcription: async (assignment, act) => {
      calls.push([act === 1 ? "down" : "up", assignment.host.hostId, assignment.threadKey!]);
    },
    reportError: (error) => { throw error; }
  });

  const pending = machine.down("action-a", owner);
  clock.advance(450);
  await machine.up("action-a");
  resolveSelection();
  await pending;
  assert.equal(calls.some(([kind]) => kind === "down"), false);
});

test("only one physical hold can start transcription at a time", async () => {
  const { calls, clock, machine } = createMachine();
  await Promise.all([machine.down("action-a", owner), machine.down("action-b", { ...owner, id: 1 })]);
  clock.advance(450);
  await Promise.resolve();
  assert.deepEqual(calls.filter(([kind]) => kind === "down"), [["down", owner.host.hostId, owner.threadKey!]]);
  await Promise.all([machine.up("action-a"), machine.up("action-b")]);
  assert.deepEqual(calls.filter(([kind]) => kind === "up"), [["up", owner.host.hostId, owner.threadKey!]]);
});

test("duplicate transitions are idempotent", async () => {
  const { calls, clock, machine } = createMachine();
  await machine.down("action-a", owner);
  await machine.down("action-a", owner);
  clock.advance(450);
  await Promise.resolve();
  await machine.up("action-a");
  await machine.up("action-a");
  assert.deepEqual(calls, [
    ["select", owner.host.hostId, owner.threadKey!],
    ["down", owner.host.hostId, owner.threadKey!],
    ["up", owner.host.hostId, owner.threadKey!]
  ]);
});

test("a settings update cancels an in-flight hold", async () => {
  const { calls, clock, machine } = createMachine();
  await machine.down("action-a", owner);
  machine.updateSettings();
  clock.advance(450);
  await Promise.resolve();
  assert.deepEqual(calls, [["select", owner.host.hostId, owner.threadKey!]]);
});

test("a started hold is released when its 60-second lease expires", async () => {
  const { calls, clock, machine } = createMachine();
  await machine.down("action-a", owner);
  clock.advance(450);
  await settle();
  clock.advance(60_000);
  await settle();
  assert.deepEqual(calls, [
    ["select", owner.host.hostId, owner.threadKey!],
    ["down", owner.host.hostId, owner.threadKey!],
    ["up", owner.host.hostId, owner.threadKey!]
  ]);
});

test("a replaced remote host rejects the captured owner instead of rerouting", async () => {
  const clock = new FakeClock();
  const calls: Call[] = [];
  let connectedHostId = "host-a";
  const machine = new AgentPressMachine({
    clock,
    settings: () => normalizeLongPressSettings(undefined),
    select: async (assignment) => { calls.push(["select", assignment.host.hostId, assignment.threadKey!]); },
    transcription: async (assignment, act) => {
      if (assignment.host.hostId !== connectedHostId) throw new Error("The task-owning Codex host is no longer connected.");
      calls.push([act === 1 ? "down" : "up", assignment.host.hostId, assignment.threadKey!]);
    },
    reportError: () => undefined
  });
  await machine.down("action-a", owner);
  connectedHostId = "host-b";
  clock.advance(450);
  await Promise.resolve();
  assert.deepEqual(calls, [["select", owner.host.hostId, owner.threadKey!]]);
});

test("a rejected transcription down edge releases the global hold for the next press", async () => {
  const clock = new FakeClock();
  const calls: Call[] = [];
  let rejectFirstDown = true;
  const machine = new AgentPressMachine({
    clock,
    settings: () => normalizeLongPressSettings(undefined),
    select: async (assignment) => { calls.push(["select", assignment.host.hostId, assignment.threadKey!]); },
    transcription: async (assignment, act) => {
      if (act === 1 && rejectFirstDown) {
        rejectFirstDown = false;
        throw new Error("transcription transport unavailable");
      }
      calls.push([act === 1 ? "down" : "up", assignment.host.hostId, assignment.threadKey!]);
    },
    reportError: () => undefined
  });

  await machine.down("action-a", owner);
  clock.advance(450);
  await settle();
  await machine.up("action-a");
  await machine.down("action-b", { ...owner, id: 1 });
  clock.advance(450);
  await settle();
  await machine.up("action-b");

  assert.deepEqual(calls, [
    ["select", owner.host.hostId, owner.threadKey!],
    ["select", owner.host.hostId, owner.threadKey!],
    ["down", owner.host.hostId, owner.threadKey!],
    ["up", owner.host.hostId, owner.threadKey!]
  ]);
});

test("stopping while transcription starts waits for the released hold", async () => {
  const clock = new FakeClock();
  const calls: string[] = [];
  let finishDown!: () => void;
  const down = new Promise<void>((resolve) => { finishDown = resolve; });
  const machine = new AgentPressMachine({
    clock,
    settings: () => normalizeLongPressSettings(undefined),
    select: async () => { calls.push("select"); },
    transcription: async (_assignment, act) => {
      if (act === 1) {
        calls.push("down-start");
        await down;
        calls.push("down-finish");
        return;
      }
      calls.push("up");
    },
    reportError: () => undefined
  });

  await machine.down("action-a", owner);
  clock.advance(450);
  await settle();
  let stopped = false;
  const stopping = machine.stop().then(() => { stopped = true; });
  await settle();
  assert.equal(stopped, false);
  finishDown();
  await stopping;
  assert.deepEqual(calls, ["select", "down-start", "down-finish", "up"]);
});

test("controller shutdown releases agent presses before closing transports", async () => {
  const events: string[] = [];
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
  const controller = {
    stopped: false,
    agentPresses: {
      stop: async () => {
        events.push("agent-cleanup-start");
        await cleanup;
        events.push("agent-cleanup-finish");
      }
    },
    relayClient: { close: () => events.push("relay-close") },
    mobileRelayServer: undefined,
    localMobileRelayServer: undefined,
    microBridge: { close: () => events.push("bridge-close") }
  };

  const shutdown = (DeckController.prototype.stop as unknown as (this: typeof controller) => Promise<void>).call(controller);
  await Promise.resolve();
  assert.deepEqual(events, ["agent-cleanup-start"]);
  finishCleanup();
  await shutdown;
  assert.deepEqual(events, ["agent-cleanup-start", "agent-cleanup-finish", "relay-close", "bridge-close"]);
});

test("long-press settings default to Codex transcription and reject malformed shortcuts", () => {
  assert.deepEqual(normalizeLongPressSettings(undefined), { mode: "codex-transcription" });
  assert.deepEqual(normalizeLongPressSettings({ mode: "macos-shortcut", shortcut: { keyCode: -1 } }), { mode: "off" });
  assert.deepEqual(normalizeLongPressSettings({
    mode: "macos-shortcut", shortcut: { modifiers: ["right-option"] }
  }), { mode: "macos-shortcut", shortcut: { modifiers: ["right-option"] } });
});
