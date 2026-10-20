import assert from "node:assert/strict";
import test from "node:test";
import { DeckController } from "../src/controller.js";

test("T3 agent keys monitor and switch threads without entering the Codex control path", async () => {
  const controller = new DeckController();
  const switches: number[] = [];
  let refreshes = 0;
  let images = 0;
  const monitor = {
    healthy: true,
    slots: [{ threadId: "a", title: "Live T3 thread", status: "thinking" }],
    refresh: async () => { refreshes++; },
    focus: async (slot: number) => { switches.push(slot); }
  };
  Object.defineProperty(controller, "t3Monitor", { value: monitor });
  Object.defineProperty(controller, "microBridge", { value: new Proxy({}, {
    get: () => () => { throw new Error("T3 must not use the Codex bridge"); }
  }) });
  controller.setAgentMode("t3");
  await new Promise((resolve) => setImmediate(resolve));
  controller.registerAgent(0, { id: "agent-a", setImage: async () => { images++; } } as never);
  await controller.beginAgentPress("agent-a", 0);
  await controller.endAgentPress("agent-a");
  await controller.beginAgentPress("empty", 5);
  await controller.cancelAgentPress("agent-a");
  assert.equal(refreshes, 1);
  assert.deepEqual(switches, [0]);
  assert(images > 0);
});
