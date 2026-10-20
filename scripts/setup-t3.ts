import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { parseT3Config, readT3Descriptor, readT3Origin, readT3Threads, T3_CONFIG_PATH, T3_RUNTIME_PATH } from "../src/t3.js";

const execFileAsync = promisify(execFile);
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    cli: { type: "string" }, "base-dir": { type: "string" }, runtime: { type: "string" },
    output: { type: "string" }, scheme: { type: "string", default: "t3code" },
    ttl: { type: "string", default: "30d" }
  } });
  if (values.scheme !== "t3code" && values.scheme !== "t3code-dev") throw new Error("Scheme must be t3code or t3code-dev.");
  const baseDir = values["base-dir"] ?? process.env.T3CODE_HOME;
  const runtimePath = resolve(values.runtime ?? (baseDir ? join(baseDir, "userdata", "server-runtime.json") : T3_RUNTIME_PATH));
  const origin = await readT3Origin({ runtimePath });
  const descriptor = await readT3Descriptor(origin);
  const output = resolve(values.output ?? T3_CONFIG_PATH);
  let previous = {};
  try {
    const existing = parseT3Config(JSON.parse(await readFile(output, "utf8")));
    if (existing.environmentId === descriptor.environmentId && existing.threadIds) previous = { threadIds: existing.threadIds };
  } catch { /* A missing/expired configuration is replaced by setup. */ }
  const cli = values.cli ?? process.env.T3_CLI ?? (process.platform === "darwin" ? join(homedir(), ".t3", "bin", "t3") : "t3");
  const args = ["auth", "session", "issue", "--scope", "orchestration:read", "--ttl", values.ttl,
    "--label", "Codex Deck thread monitor", "--token-only", ...(baseDir ? ["--base-dir", baseDir] : [])];
  let token: string;
  try { token = (await execFileAsync(cli, args, { timeout: 30_000, windowsHide: true })).stdout.trim(); }
  catch { throw new Error("Could not issue a read-only T3 session. Check the T3 CLI path (--cli) and data directory (--base-dir)."); }
  const config = parseT3Config({ ...previous, token, environmentId: descriptor.environmentId, runtimePath, scheme: values.scheme });
  await readT3Threads(origin, token);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, output);
    await chmod(output, 0o600);
  } finally { await rm(temporary, { force: true }); }
  console.log(`T3 thread monitoring configured in ${output}. Session lifetime: ${values.ttl}.`);
  console.log("Select T3 Code threads in an Agent key's Agent source setting. Pin/reorder threads in T3 to choose the six keys.");
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "T3 setup failed.");
  process.exitCode = 1;
});
