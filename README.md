# Fode

A Linux terminal harness that connects a dedicated Firefox ChatGPT tab to the real Codex app-server.

Send a task from your terminal or the extension. Fode opens a pinned **background** ChatGPT tab, streams its answer to your terminal, dispatches explicit tool requests to Codex, and sends the completed result back to ChatGPT. Your other Firefox tabs remain usable. Fode does not log in, log out, copy cookies, or replace Codex authentication.

**Status: experimental, Linux only.** Automated integration tests and a real Codex terminal smoke test pass. Authenticated ChatGPT end-to-end operation has not been verified in this environment. ChatGPT's DOM is not a stable automation API, so selectors may need updates. The extension package is unsigned; permanent release-Firefox installation requires Mozilla signing.

## Install

Requirements: Linux, Node.js 22.12+ (24 recommended), Firefox 142+, a current authenticated `codex` CLI, and systemd user services. Use native Firefox; Flatpak/Snap native messaging integration is not covered.

```sh
git clone https://github.com/connorgentile113-png/fode.git
cd fode
npm ci
npm run install:local
npm run build
```

The installer registers `local.fode` in `~/.mozilla/native-messaging-hosts`, creates `~/.local/bin/fode`, and enables `fode.service`. Keep this checkout in place; the service references it. Add `~/.local/bin` to PATH if needed.

For a **temporary development installation**, open `about:debugging#/runtime/this-firefox` in Firefox, choose **Load Temporary Add-on**, and select `extension/manifest.json`. Firefox removes temporary extensions when it exits. See [SIGNING.md](SIGNING.md) for a permanent installation.

Sign in to ChatGPT in Firefox yourself. The extension uses the browser's existing session and never asks for your password. The listening badge shows ON when connected to the native harness.

```sh
fode run "Inspect this project and fix its failing tests" --cwd "$PWD"
fode watch
fode status
fode stop
```

Alternatively click the Fode toolbar button, enter a task and an absolute working directory, then choose **Start task**. **Open pinned chat** is the only control that deliberately activates the managed tab.

The default is Codex `workspace-write` with `on-request` approvals. To explicitly grant a task unrestricted terminal access:

```sh
fode run "Build the requested app" --cwd "$PWD" --full-access
```

Full access applies to that Fode job; it does not change your Codex config. The model defaults to the installed server's advertised default. Choose another supported model with `--model MODEL`.

## What runs where

```text
fode run / Firefox popup
           │ private Unix socket (0600)
     Linux user service ←→ Firefox native messaging ←→ persistent background script
           │                                             │
     codex app-server                              pinned ChatGPT tab
           │                                             │
     real tools + streamed events ←── completed fode tool request
           │
     result ─────────────────────────────────────→ next ChatGPT message
```

ChatGPT response snapshots stream every 250 ms while changing. Execution waits until generation finishes and the answer stabilizes. Codex tool and text events stream as received. Completed Codex results return to ChatGPT as a new message, avoiding a separate ChatGPT request for every token.

Only the extension-created tab can submit chat events. Existing chats are never automatically attached or executed. Each job has a nonce, each assistant message is deduplicated, and only one explicit `fode` code block is accepted per completed response. Ordinary Bash examples are not executed.

The harness sends ChatGPT the protocol automatically:

~~~text
```fode
{"nonce":"CURRENT-RUN-NONCE","tool":"codex","prompt":"Inspect and fix the failing tests"}
```
~~~

Use `tool: "shell"` and `command` for a shell request, or `tool: "done"` and `summary` to finish. Shell requests are executed **by Codex**, using its real terminal tools and project instructions. They are not evaluated directly by the extension. A run is limited to 12 tool steps; start another task for more work.

## Codex capabilities and approvals

Fode uses the [official Codex app-server protocol](https://developers.openai.com/codex/app-server), not a replacement implementation. It inherits the installed Codex tool environment: shell, file editing, search, configured MCP tools, skills, and other available agent capabilities. Features still depend on your Codex version, account and configuration; Fode cannot manufacture unavailable tools.

All server events are forwarded, including tool output, file changes, reasoning deltas, and server requests. The popup exposes pending requests with a JSON response editor. The terminal has an unrestricted protocol escape hatch for supported non-authentication methods:

```sh
fode rpc model/list '{}'
fode rpc thread/list '{"limit":10}'
fode reply 42 '{"decision":"accept"}'
fode reply 42 '{"decision":"decline"}'
```

For questions, MCP elicitation, dynamic tools or permissions, supply the response object required by your installed protocol. Use `codex app-server generate-json-schema --out /tmp/codex-schema` to inspect it. These advanced capabilities have a generic JSON interface, not dedicated graphical controls. Authentication lifecycle methods are deliberately excluded; manage authentication in your normal Codex installation.

## Persistence and recovery

- The extension background page stays alive while Firefox is running. Native-host disconnects retry with exponential backoff and an alarm fallback.
- The Linux service starts at user login. It can queue a job while Firefox is closed; the extension opens the tab when Firefox reconnects. It does not launch Firefox itself.
- An unacknowledged outbound message is redelivered after native-host reconnection. Per-tab session storage prevents duplicate submissions and restores response observation after reload.
- The extension never overwrites a nonempty draft. Clear or send that draft before retrying.
- Closing the managed tab can lose conversation context. Stop and start a fresh job if this happens mid-response.
- Daemon restarts do **not** resume active jobs. They retain Codex's own conversation history, but discard in-memory Fode state. Restart explicitly after checking for effects of the interrupted command. There is no automatic replay of terminal work after a service crash.
- `fode stop` interrupts the current Codex turn and requests ChatGPT to stop generating. Already completed file changes or external actions are not rolled back.

## Test

```sh
npm test
npm run lint:extension
npm run build
node scripts/smoke-codex.js  # optional: makes one real model turn
```

Tests cover fragmented native frames, malformed inputs, nonce validation, partial commands, draft protection, duplicate delivery, response streaming, native-host reconnect, approval forwarding and interruption. The integration test uses a deterministic fake Codex server; the live smoke test separately verifies the real terminal tool and stream.

The runtime has no npm dependencies. At initial release, `npm audit` reports three development-only high-severity entries through the current `web-ext` → `addons-linter` → `image-size` chain (malformed image parser denial of service; no patched current release available). `npm audit --omit=dev` is clean. The extension contains no external images to parse during its build.

Manual end-to-end check after signing in: open another Firefox tab, run `fode run "Run pwd through the harness and report the result" --cwd "$PWD"`, then `fode watch`. Confirm the pinned tab opens without stealing focus, a real terminal event appears, the result returns to ChatGPT, and the job completes.

## Privacy and trust

Tasks and terminal results are sent to ChatGPT and Codex under your accounts. Do not include data you do not want those services to receive. Fode has no analytics or public listening port. Its socket and state directory are user-only. A nonce prevents stale-response execution; it is **not** a defense against prompt injection inside the active ChatGPT conversation. Use task-appropriate Codex permissions.

Firefox local storage keeps the managed tab ID, working directory and pending outbound message. Per-tab session storage keeps delivery markers and the current response baseline. The daemon keeps a bounded in-memory event history for `fode watch`; Codex maintains its own normal history.

## Troubleshooting / removal

```sh
systemctl --user status fode
journalctl --user -u fode -n 50
systemctl --user restart fode
```

If the popup is offline, check native-host registration and that `codex` is available in the service's PATH. If the pinned tab has no composer or asks for login, sign in there. If ChatGPT changes its UI, update `extension/content.js` and reload the add-on.

To remove: disable/remove the Firefox extension, run `systemctl --user disable --now fode`, then remove `~/.config/systemd/user/fode.service`, `~/.mozilla/native-messaging-hosts/local.fode.json`, `~/.local/bin/fode` and `~/.local/bin/fode-native`. Run `systemctl --user daemon-reload`. Optionally delete `~/.local/state/fode`. Do not delete your Codex configuration or authentication.

MIT licensed. Unofficial project; not affiliated with Mozilla or OpenAI.
