# Agent Long-Press Shortcut Design

## Goal

Give every Stream Deck agent key one shared, configurable long-press behavior. A short press opens the assigned Codex task; a long press starts a hold action and releasing the physical key stops it.

## Interaction

1. On agent-key down, capture the routed task owner and immediately foreground/select that task.
2. Start a 450 ms hold timer.
3. If released before the timer fires, finish with only task selection.
4. If the timer fires while still pressed, start the configured global long-press target.
5. On key up, stop that target only if it was started.

The key displays hold progress and a recording/active state after the threshold. The action must release on action disappearance, plugin shutdown, or relay disconnect.

## Global Configuration

The setting is shared by all six agent actions and stored once in Codex Deck state. Modes are:

- **Off** — short press still opens the task; a long press does nothing extra.
- **Codex transcription** — the default. Hold Codex's configured native push-to-talk/Micro action on the task-owning host.
- **macOS custom shortcut** — local only. Hold a configured macOS shortcut on the Stream Deck Mac.

The shortcut editor includes a normal-key capture field plus explicit left/right modifier options for Option, Command, Control, and Shift. It supports modifier-only holds, including Right Option (macOS virtual keycode 61).

## Routing and Safety

Task selection and Codex transcription are sent to the agent's owner captured at key-down; changing the target host while held cannot redirect either the down or up event. Existing typed relay action messages carry the transcription press/release; no arbitrary shortcut payload is sent to a remote host.

macOS shortcut mode is intentionally local. It posts paired CoreGraphics keyboard events through the built-in JavaScript automation runtime and requires the user to grant the relevant Accessibility permission. The generated event sequence presses modifiers first, then the normal key; release occurs in reverse order. Each held shortcut has a bounded local safety timeout and is released on plugin lifecycle cleanup.

## Architecture

- `src/actions.ts` owns per-physical-key timer and pressed state, while reading the global configuration from the controller.
- `src/controller.ts` resolves and pins the task owner, selects the task without dispatching the ordinary agent HID action, and starts/stops transcription on that pinned host.
- `src/codex-micro-renderer-bridge.ts` exposes task selection separately from agent-HID dispatch.
- A new macOS shortcut module validates stored keycodes/modifiers and starts/stops local CoreGraphics key events. It never runs on Windows or through the relay.
- The global settings UI is exposed through a single dedicated configuration surface rather than six divergent per-key settings.

## Testing

Unit tests cover threshold behavior, early release, owner pinning, transcription press/release pairing, lifecycle cleanup, shortcut serialization, right-option keycode handling, and rejection of unsafe/invalid shortcut settings. Relay tests prove transcription commands retain their owner while custom shortcuts never enter the relay protocol.

Manual macOS QA verifies the Accessibility prompt, Right Option hold/release with AudioPen, a normal chord, standard Codex transcription, and no stuck key after unplugging/reloading Stream Deck.
