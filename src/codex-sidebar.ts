import type { MicroAgentSlot } from "./types.js";

/** Runs inside the renderer; keep this function self-contained for CDP injection. */
export function readPinnedSidebarSlots(document: Document, nativeSlots: MicroAgentSlot[]): MicroAgentSlot[] | undefined {
  const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-pinned="true"]')];
  if (!rows.length) return undefined;
  const seen = new Set<string>();
  const slots: MicroAgentSlot[] = [];
  for (const row of rows) {
    const threadKey = row.getAttribute('data-app-action-sidebar-thread-id');
    if (!threadKey || seen.has(threadKey)) continue;
    seen.add(threadKey);
    const native = nativeSlots.find(slot => slot.threadKey === threadKey);
    // The row's status props follow the live host, unlike the unmounted Micro
    // atom which can retain a previous pinned list on newer Codex builds.
    type Fiber = { memoizedProps?: { statusState?: { type?: string; unread?: boolean } }; return?: Fiber };
    const fiberKey = Object.getOwnPropertyNames(row).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (row as unknown as Record<string, Fiber>)[fiberKey] : undefined;
    let state: { type?: string; unread?: boolean } | undefined;
    for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps?.statusState) { state = fiber.memoizedProps.statusState; break; }
    }
    const status = state
      ? state.type === 'loading' ? 'working'
        : state.type === 'error' ? 'error'
        : state.type === 'approval' ? 'awaiting-approval'
        : state.type === 'response' ? 'awaiting-response'
        : state.unread ? 'unread' : 'idle'
      : native?.status ?? 'idle';
    slots.push({
      ...native,
      id: slots.length,
      threadKey,
      title: row.getAttribute('data-app-action-sidebar-thread-title') ?? row.getAttribute('aria-label') ?? native?.title ?? null,
      status,
      selected: row.getAttribute('data-app-action-sidebar-thread-active') === 'true'
    });
    if (slots.length === 6) break;
  }
  while (slots.length < 6) slots.push({id: slots.length, threadKey: null, title: null, status: 'off', selected: false});
  return slots;
}
