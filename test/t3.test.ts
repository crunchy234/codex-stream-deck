import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseT3Config, parseT3Threads, readT3Origin, selectT3Threads, t3LocalOrigin, t3OpenSpec, T3ThreadMonitor, t3ThreadUrl, t3VisualStatus, type T3Thread } from "../src/t3.js";

const at = (n: number) => new Date(n * 1000).toISOString();
const thread = (id: string, extra: Partial<T3Thread> = {}): T3Thread => ({ id, title: id, status: "idle", updatedAt: at(1), ...extra });

test("pins follow sidebar order, retain settled pins, and exclude deleted/archived threads", () => {
  const slots = selectT3Threads([
    thread("b", { pinnedAt: at(1), pinOrderKey: "b", settledAt: at(2) }),
    thread("a", { pinnedAt: at(2), pinOrderKey: "a" }),
    thread("archived", { pinnedAt: at(3), archivedAt: at(4) }),
    thread("deleted", { pinnedAt: at(3), deletedAt: at(4) }), thread("active")
  ]);
  assert.deepEqual(slots.map((t) => t?.id), ["a", "b", undefined, undefined, undefined, undefined]);
});

test("snoozed threads leave automatic keys until they wake, so later pins move up", () => {
  const now = 50_000;
  const threads = [
    thread("first", { pinnedAt: at(1), pinOrderKey: "a" }),
    thread("snoozed", { pinnedAt: at(1), pinOrderKey: "b", snoozedAt: at(10), snoozedUntil: at(60) }),
    thread("woke", { pinnedAt: at(1), pinOrderKey: "c", snoozedAt: at(10), snoozedUntil: at(40) }),
    thread("asks", { pinnedAt: at(1), pinOrderKey: "d", snoozedAt: at(10), snoozedUntil: at(60), pendingRuntimeRequest: { kind: "approval" } }),
    thread("failed", { pinnedAt: at(1), pinOrderKey: "e", status: "failed", latestRunCompletedAt: at(20), snoozedAt: at(10), snoozedUntil: at(60) }),
    thread("failed-before", { pinnedAt: at(1), pinOrderKey: "f", status: "failed", latestRunCompletedAt: at(5), snoozedAt: at(10), snoozedUntil: at(60) }),
    thread("last", { pinnedAt: at(1), pinOrderKey: "g" })
  ];
  assert.deepEqual(selectT3Threads(threads, [], undefined, now).map((t) => t?.id),
    ["first", "woke", "asks", "failed", "last", undefined]);
  assert.equal(selectT3Threads(threads, [], undefined, 61_000)[1]?.id, "snoozed");
  // Unpinned fallback hides snoozed threads too; explicit assignments still show them.
  const active = [thread("a"), thread("z", { snoozedUntil: at(60) })];
  assert.deepEqual(selectT3Threads(active, [], undefined, now).map((t) => t?.id).filter(Boolean), ["a"]);
  assert.equal(selectT3Threads(active, [], ["z"], now)[0]?.id, "z");
});

test("inherited subagent pins cannot crowd out the sidebar's pinned threads", () => {
  const parent = thread("parent", { pinnedAt: at(2), pinOrderKey: "h" });
  const children = Array.from({ length: 4 }, (_, i) => thread(`child-${i}`, {
    pinnedAt: parent.pinnedAt, pinOrderKey: parent.pinOrderKey,
    lineage: { relationshipToParent: "subagent" }
  }));
  const threads = [
    ...children, parent,
    thread("first", { pinnedAt: at(4), pinOrderKey: "e" }),
    thread("third", { pinnedAt: at(3), pinOrderKey: "r" }),
    thread("fourth", { pinnedAt: at(1), pinOrderKey: "u" })
  ];
  assert.deepEqual(selectT3Threads(threads).map((t) => t?.id),
    ["first", "parent", "third", "fourth", undefined, undefined]);
  // A user can still explicitly assign a child, independently of sidebar pinning.
  assert.equal(selectT3Threads(threads, [], ["child-0"])[0]?.id, "child-0");
});

test("fallback positions stay stable when activity changes; retired slots are filled", () => {
  const threads = Array.from({ length: 8 }, (_, i) => thread(`t${i}`, { updatedAt: at(i + 1) }));
  const first = selectT3Threads(threads);
  const previous = first.map((t) => t?.id);
  threads[0]!.updatedAt = at(100);
  assert.deepEqual(selectT3Threads(threads, previous).map((t) => t?.id), previous);
  threads[7]!.settledAt = at(101);
  threads.push(thread("child", { updatedAt: at(200), lineage: { relationshipToParent: "subagent" } }));
  assert.deepEqual(selectT3Threads(threads, previous).map((t) => t?.id), ["t0", "t6", "t5", "t4", "t3", "t2"]);
});

test("explicit assignments leave unavailable threads empty and never substitute another identity", () => {
  assert.deepEqual(selectT3Threads([thread("a"), thread("b")], [], ["missing", null, "b"]).map((t) => t?.id),
    [undefined, undefined, "b", undefined, undefined, undefined]);
});

test("maps T3 runtime, approval, error, unread and visited states", () => {
  for (const status of ["preparing", "queued", "starting", "running", "waiting"]) assert.equal(t3VisualStatus(thread("a", { status })), "thinking");
  assert.equal(t3VisualStatus(thread("a", { status: "running", pendingRuntimeRequest: { kind: "approval" } })), "input");
  assert.equal(t3VisualStatus(thread("a", { hasActionableProposedPlan: true })), "input");
  assert.equal(t3VisualStatus(thread("a", { status: "completed", activityRunStatus: "running" })), "thinking");
  assert.equal(t3VisualStatus(thread("a", { status: "failed" })), "error");
  const completed = thread("a", { status: "completed", latestRunCompletedAt: at(2), lastVisitedAt: at(1) });
  assert.equal(t3VisualStatus(completed), "complete");
  assert.equal(t3VisualStatus(completed, 2000), "idle");
  assert.equal(t3VisualStatus({ ...completed, lastVisitedAt: at(3) }), "idle");
  assert.equal(t3VisualStatus({ ...completed, status: "running" }), "thinking");
  assert.equal(t3VisualStatus(thread("a", { status: "cancelled" })), "idle");
});

test("rejects remote endpoints, URL credentials, malformed snapshots and unsafe deep links", () => {
  for (const url of ["https://example.com", "http://192.168.1.2", "http://127.0.0.1@evil.test", "http://u:p@127.0.0.1", "http://127.0.0.1/a", "http://127.0.0.1?token=secret"]) {
    assert.throws(() => t3LocalOrigin(url), /loopback/);
  }
  assert.equal(t3LocalOrigin("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
  assert.throws(() => parseT3Config({ token: "x", environmentId: "env", threadIds: ["a", "a"] }));
  assert.throws(() => parseT3Threads({ threads: [{ id: "a" }] }));
  for (const id of [".", "..", "", " ", " padded "]) assert.throws(() => t3ThreadUrl("env", id));
  for (const id of ["../new", "a?prompt=run", "a'b", "a/b", "%2Fpath%2Fsession", "imported:项目:session", "a`$(command)"]) {
    const link = t3ThreadUrl("env", id);
    assert.equal(new URL(link).search, "");
    assert.equal(decodeURIComponent(new URL(link).pathname.split("/")[2]!), id);
    const spec = t3OpenSpec(link, "win32");
    assert.equal(link.includes("'"), false);
    assert.equal(link.includes("`"), false);
    assert.equal(spec.args.at(-1), `Start-Process -FilePath '${link}'`);
  }
  for (const link of ["https://threads/env/thread", "t3code://evil/env/thread", "t3code://threads/env/thread?prompt=run", "t3code://threads/env/thread#fragment", "t3code://threads/env/%", "t3code://threads/env/..", "t3code://threads/env/a'b"]) {
    assert.throws(() => t3OpenSpec(link, "win32"), /Invalid T3 thread link/);
  }
  assert.equal(t3ThreadUrl("env", "thread"), "t3code://threads/env/thread");
  assert.equal(t3ThreadUrl("env", "imported:codex:thread"), "t3code://threads/env/imported%3Acodex%3Athread");
  assert.doesNotThrow(() => t3OpenSpec(t3ThreadUrl("env", "imported:codex:thread"), "darwin"));
  assert.equal(t3ThreadUrl("env", "thread", "t3code-dev"), "t3code-dev://threads/env/thread");
  assert.deepEqual(t3OpenSpec(t3ThreadUrl("env", "thread"), "darwin"), { executable: "/usr/bin/open", args: ["t3code://threads/env/thread"] });
  assert.match(t3OpenSpec(t3ThreadUrl("env", "thread"), "win32").args.at(-1)!, /^Start-Process -FilePath 't3code:\/\/threads\/env\/thread'$/);
  const parsed = parseT3Threads({ threads: [{ ...thread("a"), latestVisibleMessage: { text: "private content" } }] });
  assert.equal("latestVisibleMessage" in parsed[0]!, false);
  assert.equal(parseT3Threads({threads: [thread("imported:codex:a") ]})[0]?.id, "imported:codex:a");
});

test("HTTP monitor authenticates read-only requests, opens the captured identity, and recovers from failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "t3-monitor-"));
  const runtimePath = join(directory, "runtime.json");
  const configPath = join(directory, "t3.json");
  let state = [thread("a", { status: "completed", latestRunCompletedAt: at(2) })];
  let fail = false;
  let mismatch = false;
  let redirect = false;
  let shellRequests = 0;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/t3/environment") {
      res.end(JSON.stringify({ environmentId: mismatch ? "different" : "env", orchestrationProtocolVersion: 2 }));
      return;
    }
    shellRequests++;
    assert.equal(req.headers.authorization, "Bearer fixture-token");
    assert.equal(req.headers["x-t3-orchestration-protocol"], "2");
    if (redirect) { res.writeHead(302, { location: "/stolen" }); res.end(); return; }
    res.statusCode = fail ? 401 : 200;
    res.end(JSON.stringify(fail ? { secret: "must not be logged" } : { threads: state }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await writeFile(runtimePath, JSON.stringify({ port: address.port }));
  await writeFile(configPath, JSON.stringify({ token: "fixture-token", environmentId: "env", runtimePath }));
  const opened: string[] = [];
  const monitor = new T3ThreadMonitor({ configPath, open: async (url) => { opened.push(url); } });
  try {
    await monitor.refresh();
    assert.equal(monitor.healthy, true);
    assert.equal(monitor.slots[0]?.status, "complete");
    await monitor.focus(0);
    assert.deepEqual(opened, ["t3code://threads/env/a"]);
    assert.equal(monitor.slots[0]?.status, "idle");
    state = [thread("a", { title: "renamed", status: "completed", latestRunCompletedAt: at(3) })];
    await monitor.refresh();
    assert.equal(monitor.slots[0]?.title, "renamed");
    assert.equal(monitor.slots[0]?.status, "complete");
    const importedId = `imported:claude:${encodeURIComponent(`/Users/example/${"nested-project/".repeat(15)}session.jsonl`)}`;
    assert(importedId.length > 200);
    state = [thread("a", { archivedAt: at(4) }), thread(importedId)];
    await monitor.refresh();
    assert.equal(monitor.healthy, true, "archiving alongside imported threads must not disconnect the monitor");
    assert.equal(monitor.slots[0]?.threadId, importedId);
    assert.equal(monitor.slots.some((slot) => slot?.threadId === "a"), false);
    await monitor.focus(0);
    assert.equal(decodeURIComponent(new URL(opened.at(-1)!).pathname.split("/")[2]!), importedId);
    state = [thread("a")];
    await monitor.refresh();
    fail = true;
    await assert.rejects(monitor.refresh(), /expired or was revoked/);
    assert.equal(monitor.healthy, false);
    assert.equal(monitor.slots[0]?.threadId, "a");
    await assert.rejects(monitor.focus(0), /unavailable/);
    fail = false;
    await monitor.refresh();
    assert.equal(monitor.healthy, true);
    mismatch = true;
    const count = shellRequests;
    await assert.rejects(monitor.refresh(), /environment changed/);
    assert.equal(shellRequests, count, "no credential sent to a different environment");
    mismatch = false;
    redirect = true;
    await assert.rejects(monitor.refresh(), /unavailable/);
    assert.equal(shellRequests, count + 1, "redirect is never followed with the credential");
    assert.equal((await readT3Origin({ runtimePath })), `http://127.0.0.1:${address.port}`);
    await writeFile(runtimePath, '{"port":0}');
    await assert.rejects(readT3Origin({ runtimePath }), /invalid server port/);
    assert.match(await readFile(configPath, "utf8"), /fixture-token/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a Stream Deck unread mark lasts until the thread is opened from the deck or visited in T3", async () => {
  const directory = await mkdtemp(join(tmpdir(), "t3-unread-"));
  const runtimePath = join(directory, "runtime.json");
  const configPath = join(directory, "t3.json");
  let state = [thread("a", { status: "completed", latestRunCompletedAt: at(2), lastVisitedAt: at(3) }), thread("b", { status: "running" })];
  const request = (async (url: string) => Response.json(url.endsWith("/.well-known/t3/environment")
    ? { environmentId: "env", orchestrationProtocolVersion: 2 } : { threads: state })) as typeof fetch;
  await writeFile(runtimePath, JSON.stringify({ port: 4000 }));
  await writeFile(configPath, JSON.stringify({ token: "fixture-token", environmentId: "env", runtimePath }));
  const monitor = new T3ThreadMonitor({ configPath, request, open: async () => {} });
  try {
    await monitor.refresh();
    assert.equal(monitor.slots[0]?.status, "idle");
    monitor.markUnread("a", 4_000);
    monitor.markUnread("b", 4_000);
    monitor.markUnread("missing", 4_000);
    assert.equal(monitor.slots[0]?.status, "complete");
    assert.equal(monitor.slots[1]?.status, "thinking", "live activity outranks an unread mark");
    await monitor.refresh();
    assert.equal(monitor.slots[0]?.status, "complete", "the mark survives polling");
    await monitor.focus(0);
    assert.equal(monitor.slots[0]?.status, "idle");
    monitor.markUnread("a", 4_000);
    state = [thread("a", { status: "completed", latestRunCompletedAt: at(2), lastVisitedAt: at(5) })];
    await monitor.refresh();
    assert.equal(monitor.slots[0]?.status, "idle", "visiting in T3 after the mark clears it");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
