# Agent Long-Press Shortcut Design

## Goal

Give every Stream Deck agent key one shared, configurable long-press behavior. A short press opens the assigned Codex task; a long press starts a hold action and releasing the physical key stops it.

## Interaction

1. On agent-key down, capture the routed task owner and physical-action generation, then immediately foreground/select that task.
2. Start a 450 ms hold timer.
3. If released before the timer fires, finish with only task selection.
4. If the timer fires while still pressed, start the configured global long-press target.
5. On key up, stop that target only if it was started.

The hold timer starts at physical key-down, not after selection completes. When selection completes, the controller must confirm that the same physical-action generation remains held and has crossed the threshold before it starts the long-press target. Key-up, action disappearance, plugin shutdown, and configuration changes invalidate pending selection/start work. Only one global long press may be active at a time; another agent key remains a short thread-selection press until the active hold releases.

The key displays hold progress and a recording/active state after the threshold. The action must release on action disappearance, plugin shutdown, relay disconnect, or a 60-second maximum hold lease.

## Global Configuration

The setting is shared by all six agent actions and stored once in Codex Deck state. Modes are:

- **Off** — short press still opens the task; a long press does nothing extra.
- **Codex transcription** — the default. Hold Codex's configured native push-to-talk/Micro action on the task-owning host.
- **macOS custom shortcut** — local only. Hold a configured macOS shortcut on the Stream Deck Mac.

The shortcut editor includes a normal-key capture field plus explicit left/right modifier options for Option, Command, Control, and Shift. It supports modifier-only holds, including Right Option (macOS virtual keycode 61).

## Routing and Safety

Task selection and Codex transcription are sent to the agent's owner captured at key-down; changing the target host while held cannot redirect either the down or up event. The current relay host identity must still equal the captured owner before each remote operation; a replacement connection is never treated as the original owner.

Remote task selection uses a new validated typed `select-thread` relay command with a stable `threadKey`; it does not fake an agent HID press. Existing typed relay action messages carry the transcription press/release. The relay server tracks held actions by authenticated socket and releases them when that socket closes or its 60-second lease expires. No arbitrary shortcut payload is sent to a remote host.

macOS shortcut mode is intentionally local. It posts paired CoreGraphics keyboard events through the built-in JavaScript automation runtime and requires the user to grant the relevant Accessibility permission. Stored settings contain only allowlisted numeric keycodes and modifier enums, never script text. The generated event sequence presses modifiers first, then the normal key with the corresponding modifier flags; release occurs in reverse order. A dedicated helper owns the event lifecycle and guarantees key-up at the 60-second timeout even if the plugin process terminates.

## Architecture

- `src/actions.ts` owns per-physical-action generation, timer, hold-progress rendering, and invalidation, while reading the global configuration from the controller.
- `src/controller.ts` resolves and pins the task owner, selects the task without dispatching the ordinary agent HID action, and starts/stops transcription on that pinned host.
- `src/codex-micro-renderer-bridge.ts` exposes task selection separately from agent-HID dispatch.
- `src/relay-protocol.ts` and `src/codex-relay-server.ts` add validated `select-thread` routing plus socket-owned held-action cleanup and leases.
- A new macOS shortcut helper validates stored keycodes/modifiers and starts/stops local CoreGraphics key events. It never runs on Windows or through the relay.
- The global settings UI is exposed through a single dedicated configuration surface rather than six divergent per-key settings.

## Testing

Unit tests cover threshold behavior, early release before selection completes, duplicate down/up, settings changes while held, concurrent agent keys, owner pinning, remote host replacement, transcription press/release pairing, lifecycle cleanup, shortcut serialization, right-option keycode handling, and rejection of unsafe/invalid shortcut settings. Relay tests prove selection/transcription commands retain their owner, held actions release on socket loss or lease expiry, and custom shortcuts never enter the relay protocol.

Manual macOS QA verifies the Accessibility prompt, Right Option hold/release with AudioPen, a normal chord, standard Codex transcription, and no stuck key after unplugging/reloading Stream Deck.
