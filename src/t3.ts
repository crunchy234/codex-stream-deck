import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { codexDeckStateRoot } from "./codex-deck-paths.js";
import type { AgentVisualStatus } from "./types.js";

const execFileAsync = promisify(execFile);
export const T3_CONFIG_PATH = join(codexDeckStateRoot(), "t3.json");
export const T3_RUNTIME_PATH = join(homedir(), ".t3", "userdata", "server-runtime.json");

export type T3Config = {
  token: string;
  environmentId: string;
  runtimePath?: string;
  url?: string;
  scheme?: "t3code" | "t3code-dev";
  /** Optional fixed assignments. Null leaves that key empty. Otherwise use T3's pinned order. */
  threadIds?: Array<string | null>;
};
export type T3Thread = {
  id: string;
  title: string;
  status: string;
  updatedAt?: string;
  activityRunStatus?: string | null;
  latestRunCompletedAt?: string | null;
  lastVisitedAt?: string | null;
  pendingRuntimeRequest?: object | null;
  hasActionableProposedPlan?: boolean;
  archivedAt?: string | null;
  deletedAt?: string | null;
  settledAt?: string | null;
  pinnedAt?: string | null;
  snoozedAt?: string | null;
  snoozedUntil?: string | null;
  pinOrderKey?: string | null;
  activeOrderKey?: string | null;
  lineage?: { relationshipToParent?: string };
};
export type T3AgentSlot = {
  threadId: string;
  title: string;
  status: AgentVisualStatus;
};

export function parseT3Config(value: unknown): T3Config {
  const c = value as Partial<T3Config> | null;
  if (!c || typeof c.token !== "string" || !c.token.trim() || /[\r\n]/.test(c.token)
    || typeof c.environmentId !== "string" || !validId(c.environmentId)
    || (c.url !== undefined && typeof c.url !== "string")
    || (c.runtimePath !== undefined && typeof c.runtimePath !== "string")
    || (c.scheme !== undefined && c.scheme !== "t3code" && c.scheme !== "t3code-dev")
    || (c.threadIds !== undefined && (!Array.isArray(c.threadIds) || c.threadIds.length > 6
      || c.threadIds.some((id) => id !== null && (typeof id !== "string" || !validId(id)))
      || new Set(c.threadIds.filter((id) => id !== null)).size !== c.threadIds.filter((id) => id !== null).length))) {
    throw new Error("Invalid T3 configuration; run npm run setup:t3 again.");
  }
  if (c.url) t3LocalOrigin(c.url);
  return c as T3Config;
}

function validId(id: string): boolean {
  // T3 entity IDs are opaque TrimmedNonEmptyString values, not UUIDs.
  // Imported IDs can contain encoded paths and exceed 200 characters.
  return id.length > 0 && id === id.trim();
}

/** Never send the bearer credential to a remote host or follow redirects. */
export function t3LocalOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("T3 endpoint must be a loopback HTTP URL."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("T3 endpoint must be a loopback HTTP URL.");
  }
  return url.origin;
}

export async function readT3Origin(config: Pick<T3Config, "url" | "runtimePath">): Promise<string> {
  if (config.url) return t3LocalOrigin(config.url);
  let runtime: { port?: number };
  try { runtime = JSON.parse(await readFile(config.runtimePath ?? T3_RUNTIME_PATH, "utf8")); }
  catch { throw new Error("T3 Code is not running, or its runtime file is unavailable."); }
  if (!Number.isInteger(runtime?.port) || runtime.port! < 1 || runtime.port! > 65535) {
    throw new Error("T3 Code published an invalid server port.");
  }
  return `http://127.0.0.1:${runtime.port}`;
}

async function readJson(url: string, headers: Record<string, string>, request = fetch): Promise<unknown> {
  let response: Response;
  try { response = await request(url, { headers, signal: AbortSignal.timeout(2500), redirect: "error" }); }
  catch { throw new Error("T3 Code is unavailable; check that the desktop app is running."); }
  if (response.status === 401 || response.status === 403) throw new Error("T3 access expired or was revoked; run npm run setup:t3 again.");
  if (!response.ok) throw new Error(`T3 thread monitoring failed (HTTP ${response.status}).`);
  try { return await response.json(); }
  catch { throw new Error("T3 returned an invalid monitoring response."); }
}

export async function readT3Descriptor(origin: string, request = fetch): Promise<{ environmentId: string }> {
  const descriptor = await readJson(`${t3LocalOrigin(origin)}/.well-known/t3/environment`, {}, request) as { environmentId?: string; orchestrationProtocolVersion?: number } | null;
  if (!descriptor || typeof descriptor.environmentId !== "string" || !validId(descriptor.environmentId)
    || descriptor.orchestrationProtocolVersion !== 2) throw new Error("This T3 Code server does not support thread monitoring protocol 2.");
  return { environmentId: descriptor.environmentId };
}

export function parseT3Threads(value: unknown): T3Thread[] {
  const snapshot = value as { threads?: unknown } | null;
  if (!snapshot || !Array.isArray(snapshot.threads)) throw new Error("T3 returned an invalid thread snapshot.");
  return snapshot.threads.map((value: unknown) => {
    const t = value as T3Thread | null;
    if (!t || typeof t.id !== "string" || !validId(t.id) || typeof t.title !== "string" || typeof t.status !== "string") {
      throw new Error("T3 returned an invalid thread record.");
    }
    // Keep content-free shell fields only; never retain conversation previews.
    return {
      id: t.id, title: t.title, status: t.status, activityRunStatus: t.activityRunStatus,
      updatedAt: t.updatedAt, latestRunCompletedAt: t.latestRunCompletedAt, lastVisitedAt: t.lastVisitedAt,
      pendingRuntimeRequest: t.pendingRuntimeRequest, hasActionableProposedPlan: t.hasActionableProposedPlan,
      archivedAt: t.archivedAt, deletedAt: t.deletedAt, settledAt: t.settledAt,
      pinnedAt: t.pinnedAt, snoozedAt: t.snoozedAt, snoozedUntil: t.snoozedUntil, pinOrderKey: t.pinOrderKey, activeOrderKey: t.activeOrderKey, lineage: t.lineage
    };
  });
}

export async function readT3Threads(origin: string, token: string, request = fetch): Promise<T3Thread[]> {
  return parseT3Threads(await readJson(`${t3LocalOrigin(origin)}/api/orchestration/shell`, {
    authorization: `Bearer ${token}`, "x-t3-orchestration-protocol": "2"
  }, request));
}

function timestamp(value: string | null | undefined): number {
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}

export function t3VisualStatus(thread: T3Thread, readAt = 0): AgentVisualStatus {
  if (thread.pendingRuntimeRequest || thread.hasActionableProposedPlan) return "input";
  if (["preparing", "queued", "starting", "running", "waiting"].includes(thread.activityRunStatus ?? thread.status)) return "thinking";
  if (thread.status === "failed") return "error";
  if (thread.status === "completed" && timestamp(thread.latestRunCompletedAt) > Math.max(timestamp(thread.lastVisitedAt), readAt)) return "complete";
  return "idle";
}

/** Mirrors T3's sidebar: a snoozed thread is shelved until its wake time, or until it needs input or fails. */
export function t3Snoozed(thread: T3Thread, now = Date.now()): boolean {
  if (timestamp(thread.snoozedUntil) <= now || thread.pendingRuntimeRequest) return false;
  return !(thread.status === "failed" && (!thread.snoozedAt
    || timestamp(thread.latestRunCompletedAt ?? thread.updatedAt) > timestamp(thread.snoozedAt)));
}

/** Pinned keys follow explicit sidebar ordering; unpinned keys retain their identities as activity changes. */
export function selectT3Threads(threads: T3Thread[], previous: Array<string | undefined> = [], fixed?: Array<string | null>, now = Date.now()): Array<T3Thread | undefined> {
  const live = threads.filter((t) => !t.archivedAt && !t.deletedAt);
  const byId = new Map(live.map((t) => [t.id, t]));
  if (fixed) return Array.from({ length: 6 }, (_, i) => byId.get(fixed[i] ?? ""));
  // Snoozed threads leave T3's pinned and active sections, so later keys move up.
  const visible = live.filter((t) => !t3Snoozed(t, now));
  // Subagents can inherit their parent's pin metadata, but are hidden from
  // T3's pinned sidebar. They must not consume the six automatic slots.
  const pinned = visible.filter((t) => t.pinnedAt && t.lineage?.relationshipToParent !== "subagent");
  if (pinned.length) {
    pinned.sort((a, b) => {
      if (a.pinOrderKey && b.pinOrderKey && a.pinOrderKey !== b.pinOrderKey) return a.pinOrderKey < b.pinOrderKey ? -1 : 1;
      return timestamp(b.pinnedAt) - timestamp(a.pinnedAt) || a.id.localeCompare(b.id);
    });
    return Array.from({ length: 6 }, (_, i) => pinned[i]);
  }
  const candidates = visible.filter((t) => !t.settledAt && t.lineage?.relationshipToParent !== "subagent");
  const eligible = new Set(candidates.map((t) => t.id));
  const result = Array.from({ length: 6 }, (_, i) => eligible.has(previous[i] ?? "") ? byId.get(previous[i]!) : undefined);
  const assigned = new Set(result.flatMap((t) => t ? [t.id] : []));
  const remaining = candidates.filter((t) => !assigned.has(t.id)).sort((a, b) => {
    if (a.activeOrderKey && b.activeOrderKey && a.activeOrderKey !== b.activeOrderKey) return a.activeOrderKey < b.activeOrderKey ? -1 : 1;
    return timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id);
  });
  return result.map((t) => t ?? remaining.shift());
}

export function t3ThreadUrl(environmentId: string, threadId: string, scheme: "t3code" | "t3code-dev" = "t3code"): string {
  if (!validId(environmentId) || !validId(threadId) || [environmentId, threadId].some((id) => id === "." || id === "..")
    || !["t3code", "t3code-dev"].includes(scheme)) throw new Error("Invalid T3 thread link.");
  // Encode each opaque identity exactly once, including existing percent escapes.
  // Escape characters encodeURIComponent leaves literal so shell launch arguments
  // cannot acquire quotes or other command syntax from an identifier.
  const segment = (id: string) => encodeURIComponent(id).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${scheme}://threads/${segment(environmentId)}/${segment(threadId)}`;
}

export function t3OpenSpec(url: string, platform = process.platform, systemRoot = process.env.SystemRoot ?? "C:\\Windows"): { executable: string; args: string[] } {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    if (segments.length !== 3 || !["t3code:", "t3code-dev:"].includes(parsed.protocol)
      || t3ThreadUrl(decodeURIComponent(segments[1]!), decodeURIComponent(segments[2]!),
        parsed.protocol === "t3code:" ? "t3code" : "t3code-dev") !== url) throw new Error();
  } catch { throw new Error("Invalid T3 thread link."); }
  if (platform === "darwin") return { executable: "/usr/bin/open", args: [url] };
  if (platform === "win32") return {
    executable: win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath '${url}'`]
  };
  throw new Error(`Opening T3 links is unsupported on ${platform}.`);
}

export class T3ThreadMonitor {
  slots: Array<T3AgentSlot | undefined> = [];
  healthy = false;
  private config?: T3Config;
  private threads: Array<T3Thread | undefined> = [];
  private readonly readAt = new Map<string, number>();
  /** Stream Deck unread marks, keyed like readAt, with the time they were made. */
  private readonly markedUnreadAt = new Map<string, number>();
  constructor(private readonly options: {
    configPath?: string;
    request?: typeof fetch;
    open?: (url: string) => Promise<void>;
  } = {}) {}

  async refresh(): Promise<void> {
    try { await this.refreshOnce(); }
    catch (error) { this.healthy = false; throw error; }
  }

  private async refreshOnce(): Promise<void> {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(this.options.configPath ?? T3_CONFIG_PATH, "utf8")); }
    catch { throw new Error("T3 monitoring is not configured; run npm run setup:t3."); }
    const config = parseT3Config(raw);
    const origin = await readT3Origin(config);
    // Confirm the environment before disclosing its credential to a discovered port.
    const descriptor = await readT3Descriptor(origin, this.options.request);
    if (descriptor.environmentId !== config.environmentId) throw new Error("T3 environment changed; run npm run setup:t3 again.");
    const threads = await readT3Threads(origin, config.token, this.options.request);
    const previous = this.config?.environmentId === config.environmentId ? this.threads.map((t) => t?.id) : [];
    this.threads = selectT3Threads(threads, previous, config.threadIds);
    this.config = config;
    this.updateSlots();
    this.healthy = true;
  }

  async focus(slot: number): Promise<void> {
    const thread = this.threads[slot];
    if (!this.healthy || !this.config || !thread) throw new Error("This T3 thread is unavailable.");
    const config = this.config;
    const url = t3ThreadUrl(config.environmentId, thread.id, config.scheme);
    if (this.options.open) await this.options.open(url);
    else {
      const spec = t3OpenSpec(url);
      try { await execFileAsync(spec.executable, spec.args, { timeout: 5000, windowsHide: true }); }
      catch { throw new Error("T3 thread could not be opened; check that T3 Code handles t3code links."); }
    }
    // Only acknowledge the completion that was displayed, never work completing during navigation.
    this.readAt.set(`${config.environmentId}/${thread.id}`, timestamp(thread.latestRunCompletedAt));
    this.markedUnreadAt.delete(`${config.environmentId}/${thread.id}`);
    this.updateSlots();
  }

  /** Shows an idle thread as unread on the deck until it is opened from the deck or in T3. */
  markUnread(threadId: string, now = Date.now()): void {
    if (!this.config || !this.threads.some((t) => t?.id === threadId)) return;
    this.markedUnreadAt.set(`${this.config.environmentId}/${threadId}`, now);
    this.updateSlots();
  }

  private updateSlots(): void {
    this.slots = this.threads.map((t) => {
      if (!t) return undefined;
      const key = `${this.config?.environmentId}/${t.id}`;
      const status = t3VisualStatus(t, this.readAt.get(key));
      const marked = this.markedUnreadAt.get(key);
      // Visiting the thread in T3 after the mark acknowledges it as read.
      if (marked !== undefined && timestamp(t.lastVisitedAt) > marked) this.markedUnreadAt.delete(key);
      return {
        threadId: t.id, title: t.title || "New thread",
        status: status === "idle" && this.markedUnreadAt.has(key) ? "complete" : status
      };
    });
  }
}
