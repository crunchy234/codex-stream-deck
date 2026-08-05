import assert from "node:assert/strict";
import test from "node:test";
import { visualStatusFromMicro, visualStatusFromOtty } from "../src/status.js";

test("Otty pi states map to the Stream Deck status palette", () => {
  assert.equal(visualStatusFromOtty("processing"), "thinking");
  assert.equal(visualStatusFromOtty("idle"), "complete");
  assert.equal(visualStatusFromOtty("awaiting"), "input");
  assert.equal(visualStatusFromOtty("unknown"), "empty");
});

test("native Micro states map to the Stream Deck status palette", () => {
  assert.equal(visualStatusFromMicro("off"), "empty");
  assert.equal(visualStatusFromMicro("working"), "thinking");
  assert.equal(visualStatusFromMicro("thinking"), "thinking");
  assert.equal(visualStatusFromMicro("unread"), "complete");
  assert.equal(visualStatusFromMicro("done"), "complete");
  assert.equal(visualStatusFromMicro("completed"), "complete");
  assert.equal(visualStatusFromMicro("approval"), "input");
  assert.equal(visualStatusFromMicro("awaiting-approval"), "input");
  assert.equal(visualStatusFromMicro("awaiting-response"), "input");
  assert.equal(visualStatusFromMicro("error"), "error");
  assert.equal(visualStatusFromMicro("idle"), "idle");
  assert.equal(visualStatusFromMicro("future-state"), "idle");
});
