import type { AgentVisualStatus } from "./types.js";

export function visualStatusFromOtty(state: string): AgentVisualStatus {
  if (state === "processing") return "thinking";
  if (state === "idle") return "idle";
  if (state === "awaiting") return "input";
  return "empty";
}

export function visualStatusFromMicro(status: string): AgentVisualStatus {
  switch (status) {
    case "off": return "empty";
    case "working":
    case "thinking":
      return "thinking";
    case "unread":
    case "complete":
    case "completed":
    case "done":
      return "complete";
    case "approval":
    case "awaiting-approval":
    case "awaiting-response":
      return "input";
    case "error": return "error";
    default: return "idle";
  }
}
