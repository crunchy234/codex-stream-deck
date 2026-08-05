import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { codexDeckStateRoot } from "./codex-deck-paths.js";
import { visualStatusFromOtty } from "./status.js";
import type { AgentVisualStatus } from "./types.js";

const execFileAsync = promisify(execFile);
const defaultCli = "/Applications/Otty.app/Contents/MacOS/otty-cli";

type Tab = { id: string; index: number; title: string; active: boolean };
type Pane = { id: string; tab_id: string };
type PiRecord = { version: 1; paneId: string; pid: number; sessionId: string; cwd: string; state: string; updatedAt: number; contextUsedPercent?: number };

export type OttyAgentSlot = { tabId: string; title: string; status: AgentVisualStatus; selected: boolean; contextUsedPercent?: number };
export type OttyOptions = {
  cli?: string;
  stateDirectory?: string;
  run?: (args: string[]) => Promise<string>;
  alive?: (pid: number) => boolean;
};

function paneId(value: string): string {
  return value.startsWith("p_") ? value.slice(2) : value;
}

function contextUsedPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function validRecord(value: unknown): value is PiRecord {
  const item = value as Partial<PiRecord> | null;
  return item?.version === 1 && typeof item.paneId === "string" && typeof item.pid === "number"
    && Number.isInteger(item.pid) && item.pid > 0 && typeof item.sessionId === "string"
    && typeof item.cwd === "string" && typeof item.state === "string" && typeof item.updatedAt === "number";
}

export function joinOttyAgentSlots(
  tabs: Tab[], panes: Pane[], records: PiRecord[], alive: (pid: number) => boolean
): Array<OttyAgentSlot | undefined> {
  const panesByTab = new Map<string, Set<string>>();
  for (const pane of panes) {
    let tabPanes = panesByTab.get(pane.tab_id);
    if (!tabPanes) {
      tabPanes = new Set();
      panesByTab.set(pane.tab_id, tabPanes);
    }
    tabPanes.add(paneId(pane.id));
  }
  const liveByPane = new Map<string, PiRecord>();
  for (const record of records.filter((record) => alive(record.pid))) {
    const id = paneId(record.paneId);
    const current = liveByPane.get(id);
    if (!current || current.updatedAt < record.updatedAt) liveByPane.set(id, record);
  }
  const slots: Array<OttyAgentSlot | undefined> = Array.from({ length: 6 });
  for (const tab of tabs) {
    if (tab.index < 0 || tab.index >= slots.length) continue;
    const record = [...(panesByTab.get(tab.id) ?? [])].map((paneId) => liveByPane.get(paneId)).find(Boolean);
    if (record) {
      const percent = contextUsedPercent(record.contextUsedPercent);
      slots[tab.index] = {
        tabId: tab.id,
        title: tab.title || `Tab ${tab.index + 1}`,
        status: visualStatusFromOtty(record.state),
        selected: tab.active,
        ...(percent != null ? { contextUsedPercent: percent } : {})
      };
    }
  }
  return slots;
}

export async function readOttyAgentSlots(options: OttyOptions = {}): Promise<Array<OttyAgentSlot | undefined>> {
  if (process.platform !== "darwin") return [];
  const cli = options.cli ?? process.env.OTTY_CLI ?? defaultCli;
  const run = options.run ?? (async (args: string[]) => (await execFileAsync(cli, args, { timeout: 3000 })).stdout);
  const parse = <T>(text: string): T => (JSON.parse(text) as { data: T }).data;
  const [tabs, panes] = await Promise.all([
    run(["tab", "list", "--json"]).then(parse<Tab[]>),
    run(["pane", "list", "--json"]).then(parse<Pane[]>)
  ]);
  const directory = options.stateDirectory ?? join(codexDeckStateRoot(), "otty-pi");
  const records = await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json")).map(async (name) => {
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, name), "utf8"));
      return validRecord(value) ? value : null;
    } catch {
      return null;
    }
  }));
  const alive = options.alive ?? ((pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  return joinOttyAgentSlots(tabs, panes, records.filter((record): record is PiRecord => record != null), alive);
}

export async function focusOttyTab(tabId: string, options: OttyOptions = {}): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Otty agent tabs require macOS.");
  const cli = options.cli ?? process.env.OTTY_CLI ?? defaultCli;
  if (options.run) {
    await options.run(["tab", "focus", tabId]);
    return;
  }
  await execFileAsync(cli, ["tab", "focus", tabId], { timeout: 3000 });
}
