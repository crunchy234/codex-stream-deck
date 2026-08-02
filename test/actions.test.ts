import assert from "node:assert/strict";
import test from "node:test";
import { Agent1 } from "../src/actions.js";

test("agent disappearance delegates press cleanup to the controller once", async () => {
  let cleanupCalls = 0;
  const controller = {
    cancelAgentPress: async (_actionId: string) => { cleanupCalls += 1; },
    unregisterAgent: (action: { id: string }) => {
      void controller.cancelAgentPress(action.id).catch(() => undefined);
    }
  };
  const action = new Agent1(controller as never);

  action.onWillDisappear({ action: { id: "agent-a" } } as never);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cleanupCalls, 1);
});
