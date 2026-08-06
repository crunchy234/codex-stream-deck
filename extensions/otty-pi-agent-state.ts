import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type State = "processing" | "idle" | "awaiting";

const directory = join(homedir(), "Library", "Application Support", "CodexDeck", "otty-pi");
const path = join(directory, `${process.pid}.json`);

function contextUsedPercent(ctx: any): number | undefined {
  const percent = ctx.getContextUsage?.()?.percent;
  return typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined;
}

async function publish(state: State, ctx: any, completionAt?: number): Promise<void> {
  const paneId = process.env.OTTY_PANE_ID;
  if (!paneId) return;
  const percent = contextUsedPercent(ctx);
  const value = JSON.stringify({
    version: 1,
    paneId,
    pid: process.pid,
    sessionId: String(ctx.sessionManager.getSessionId()),
    cwd: String(ctx.cwd),
    state,
    updatedAt: Date.now(),
    ...(percent != null ? { contextUsedPercent: percent } : {}),
    ...(completionAt != null ? { completionAt } : {})
  }) + "\n";
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export default function (pi: any): void {
  pi.on("session_start", (_event: unknown, ctx: any) => publish("idle", ctx).catch(() => {}));
  pi.on("before_agent_start", (_event: unknown, ctx: any) => publish("processing", ctx).catch(() => {}));
  pi.on("tool_call", (_event: unknown, ctx: any) => publish("processing", ctx).catch(() => {}));
  pi.on("agent_settled", (_event: unknown, ctx: any) => publish("idle", ctx, Date.now()).catch(() => {}));
  pi.on("session_shutdown", () => rm(path, { force: true }).catch(() => {}));
}
