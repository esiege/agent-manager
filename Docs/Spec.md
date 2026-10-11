# Agent Manager spec

Oct 9, 2026 · @Jesse

Build one local dashboard that shows every Claude agent a person runs (each VS Code window, terminal, cloud session and sub-agent): what it is doing now, what it will do next, and controls to pause it or keep it away from things the person is using. It is built on Claude Code's public extension points (hooks, MCP, a CLI), with no changes to Claude itself.

## Why

Someone running many Claude agents for hours can't see what each one is doing or stop one from disrupting their own work, and learns late that an agent is stuck. On 2026-10-09 one developer had 7 Claude Code sessions open across 2 projects (counted with Claude Code's `/list-agents`), with jobs of up to an hour: a 60-minute asset import, and 10–20-minute screenshot test runs.

| What happened | What was missing | Covered by |
| --- | --- | --- |
| An agent closed the game the person was using to record a demo, because its next build step needs the game closed. | A "hands off" that every agent obeys, and a warning before an agent closes something. | H-01 to H-07, D-07 |
| The person didn't know how to pause an agent mid-task. | A visible Pause for one agent or all. | D-04, D-05 |
| In the VR headset, or away from the desk, they couldn't tell what the agents were doing or when a build would be ready to test. | Status visible from anywhere, including inside the app being tested. | D-01 to D-03, D-15 |
| Permission prompts and questions sat in VS Code windows nobody was looking at. | One inbox for everything waiting on the person. | D-08, D-09 |
| An hour-long job showed no progress and no end time. | Elapsed time, an estimate and the log tail for long jobs. | D-03 |
| Two agents on one repo can't build at the same time (the editor locks the content), and they kept apart by convention only. | Locks between agents, with a queue. | H-08, H-09 |
| Screenshots and test builds ended up in temp folders and chat transcripts. | One list of what's ready for the person to check. | D-10 |

Claude Code already covers part of this (Agent View, Remote Control, cross-session messaging), but none of it offers holds, pausing, or one view of every VS Code window. See "Where the data comes from".

## Goals and non-goals

The manager is a local control room for agents. People keep talking to agents where they already do (VS Code, the terminal, Agent View, Remote Control).

Goals:

1. See every agent on the machine on one page, with what each one is doing in plain words, never more than 2 s out of date.
2. Know before an agent does something disruptive, and stop it with one click.
3. Put holds on apps, devices and ports that agents can't get past, even when an agent forgets the rule.
4. Pause and resume one agent or all of them.
5. Reach everything that's waiting on the person from one inbox, and later from a phone.
6. Find what agents produced for the person to check.

Non-goals:

- Replacing the chat, the IDE, Agent View or Remote Control. The manager links to them for conversation and attaching.
- Starting or planning agent work. Agent View already dispatches background sessions.
- Editing code or reviewing diffs.
- Cost and usage reporting. Claude Code's OpenTelemetry export already feeds existing tools.
- Supervising non-Claude tools, beyond the `agentctl guard` check that any script can call.

## At a glance

&#91;embedded content: architecture · sessions, the local service, its views\]

Hooks in the person's Claude Code settings send every session's events to one local service. It answers each guarded call, messages agents through their inboxes, and serves the board, the phone and apps under test.

## Concepts

| Term | Meaning |
| --- | --- |
| Agent | One Claude session: a VS Code chat, a terminal session, a background session, a cloud session, or a sub-agent (shown nested under the session that started it). |
| Project | The folder (usually a git repo) an agent works in. The board groups agents by project. |
| Activity | What the agent is doing now, in one line. It comes from the description each tool call carries, or from the agent itself. |
| Job | A command that runs longer than 60 s (a build, an import, a test run), tracked with elapsed time, an estimate and its log. |
| Next up | A disruptive step the agent has announced, with when it will happen. |
| Resource | A named thing an agent can disrupt: an app, a device, a port, a build folder. Each project defines its own. |
| Hold | The person's "hands off" on one resource, a project or everything. It is enforced, and can carry a reason and an end time. |
| Lock | An agent's exclusive claim on a resource, so that other agents queue for it. It is a lease that expires. |
| Request | Anything waiting on the person: a permission prompt, a question, an agent asking for a held resource. |
| Output | Something an agent hands the person: a screenshot, a link, a log or a build. It is marked "ready" when the agent wants the person to test it. |

## The dashboard

The board answers three questions at a glance: what each agent is doing, what is waiting on the person, and what is about to disrupt them. A phase can't ship without its Must items.

| ID | Requirement | Priority | Phase |
| --- | --- | --- | --- |
| D-01 | Every running Claude Code session on the machine appears within 5 s of starting, with no per-project setup: its name, project folder, git branch, surface (VS Code, terminal, background, cloud), model and start time. | Must | 1 |
| D-02 | Each agent shows a state (Working, Waiting on you, Idle, Paused, Blocked by a hold, Failed, Ended) and a one-line activity, at most 2 s behind its latest tool call. | Must | 1 |
| D-03 | Jobs show elapsed time, the last 20 lines of their log, and an estimated end: the agent's own estimate, or the median of past runs of the same command. | Should | 1 |
| D-04 | Pause one agent or all of them. A paused agent starts no new tool call until it is resumed; a command already running finishes, and the card reads "Pausing after: \<step>". | Must | 1 |
| D-05 | Resume sets paused agents going again within 5 s, with no typing in their windows. Stop ends an agent's current turn, like pressing Esc in its window. | Must | 1 |
| D-06 | Kill a running job's process tree from its card, after a confirmation. | Should | 2 |
| D-07 | Next up: a disruptive step (closing or launching an app, restarting a service, taking a device) shows on the card and as a notification, with a countdown and a Hold button. | Must | 1 |
| D-08 | Inbox: every permission prompt, question and request from any agent, newest first, with the project, the exact command and the agent's reason. One click focuses that agent's window. | Must | 1 |
| D-09 | Answer permission prompts from the inbox (allow once or deny), without going to the window. | Should | 2 |
| D-10 | Outputs: screenshots, links, logs and builds, shown per agent and in one "Ready for you" list with thumbnails. | Should | 2 |
| D-11 | Send a short text message to an agent from its card. It arrives between the agent's tool calls. | Could | 2 |
| D-12 | Timeline per agent: tool calls with their descriptions, durations and exit codes (not their output), kept 30 days and searchable. | Should | 2 |
| D-13 | Notifications when an agent is waiting on the person, a job finishes or fails, an agent is blocked by a hold, or a step is next up. One per agent per change of state, and silent while a hold marked "recording" is on. Desktop toasts in phase 1, phone in phase 2. | Must | 1 |
| D-14 | Views: a desktop web page and a tray icon with counts and the global hold switch (phase 1), and a phone-sized page (phase 2). | Must | 1 |
| D-15 | A read API and a hold toggle that other apps call, so an app being tested (for example a VR game) can show agent status and a Hold button inside itself. | Should | 2 |

## Holds and locks

A hold is enforced at two gates an agent can't skip: Claude Code's PreToolUse hook on every tool call, and an `agentctl guard` check inside the project's own scripts. Keeping agents off the person's things never depends on an agent remembering a rule.

| ID | Requirement | Priority | Phase |
| --- | --- | --- | --- |
| H-01 | Each project defines its resources in a checked-in file (`.agent-manager/resources.json`): a name, how to tell it's in use (process, port, window title, device), the command patterns that touch it, and an optional warning time. | Must | 1 |
| H-02 | The person can hold one resource, a whole project, or everything ("Do not disturb"), with an optional reason ("recording") and an end (15, 30 or 60 min, or until released). | Must | 1 |
| H-03 | Gate 1: a PreToolUse hook denies any tool call whose command matches a held resource's patterns, and tells the agent who holds it, why and until when. | Must | 1 |
| H-04 | Gate 2: project scripts call `agentctl guard <resource>` before disruptive steps, and it exits non-zero while the resource is held. This catches steps hidden inside a script whose name doesn't show them, such as a relaunch script that first closes the app. | Must | 1 |
| H-05 | Implicit hold: an app the person started themselves (not through `agentctl launch`) counts as held. An agent that needs it raises an inbox request, such as "musik-4a wants to close Musik.exe, which you started. Allow?" | Must | 1 |
| H-06 | Warning time: a resource can set one (for example 60 s). The first matching call waits that long while a notification offers Hold, and Hold during the wait denies the call. | Must | 1 |
| H-07 | Fail closed: if the manager isn't running, both gates refuse guarded steps with "Agent Manager not running: can't confirm \<resource> is free". Every other call goes ahead. | Must | 1 |
| H-08 | Locks: an agent claims a resource exclusively with `agentctl lock`. Other agents queue in order and see who holds it and when it is expected back. | Should | 2 |
| H-09 | Locks are leases: freed when the agent ends or after 2 min without a heartbeat. The person can break any lock, and a person's hold always beats an agent's lock. | Should | 2 |
| H-10 | Every hold, release, lock, allow and deny is logged with who and when. | Should | 1 |

Gate 1 must be a `command` hook, not an `http` hook. Claude Code treats a failed HTTP hook as a non-blocking error and runs the call, which would break H-07. The command hook keeps a local copy of the resource patterns, so it can refuse guarded calls on its own.

A resource file for a project with a VR game, a headset and a web dev server:

```json
{
  "resources": [
    {
      "name": "game",
      "label": "Musik (VR game)",
      "inUse": { "process": "Musik.exe" },
      "commands": ["Relaunch.ps1", "Stop-Process .*Musik", "taskkill .*Musik"],
      "warnSeconds": 60
    },
    {
      "name": "headset",
      "label": "Quest 3 over Link",
      "inUse": { "process": "OVRServer_x64.exe" },
      "commands": ["adb .*(install|reboot)"]
    },
    {
      "name": "dev-server",
      "label": "Web dev server on :5173",
      "inUse": { "port": 5173 },
      "commands": ["npm run dev", "Stop-Process .*node"]
    }
  ]
}
```

&#91;embedded content: a guarded step · two gates, three outcomes\]

Gate 1 sees every tool call. Gate 2 catches what a script hides, so a step that slips past one gate still meets the other.

## What agents need

Agents get the baseline for free through hooks. A small CLI lets agents and their scripts add what hooks can't see: what's coming next, hold checks, locks and outputs.

From the agent's side, working safely for hours while the person is elsewhere takes four things:

- Knowing whether something is off limits before acting, cheaply and at any time, not finding out from an upset message afterwards.
- A way to say "in about 10 minutes I'll need to restart the game", so the person can object before it happens.
- When blocked, a clear reason and a message once the thing is free, so the agent can do other work in the meantime instead of polling.
- Pause and resume signals it can't miss, delivered between its tool calls.

| ID | Requirement | Priority | Phase |
| --- | --- | --- | --- |
| A-01 | Zero-effort baseline: user-level hooks (`~/.claude/settings.json`) report session start and end, every tool call (tool, description, duration, exit code), prompts waiting, and turn ends, with no change to projects or agent instructions. | Must | 1 |
| A-02 | One CLI, `agentctl`, callable from any shell an agent or script uses (PowerShell, bash, cmd, Python). Calls return in under 200 ms and wait only when asked to (`--wait`). | Must | 1 |
| A-03 | The CLI knows which session is calling without being told: a SessionStart hook sets `AGENT_MANAGER_SESSION` for the session's commands through `CLAUDE_ENV_FILE`. | Must | 1 |
| A-04 | Errors are loud: a failed call exits non-zero with a one-line reason the agent can act on. No call silently does nothing. | Must | 1 |
| A-05 | Agents can list the holds and locks on their project (`agentctl holds`), so they plan around them instead of discovering them on a denied call. | Must | 1 |
| A-06 | Messages to an agent (resume, hold released, a note from the person) arrive through Claude Code's session inbox: between tool calls, or as a new turn when the agent is idle. | Should | 2 |
| A-07 | The same calls as MCP tools for Claude surfaces without a shell (Claude Desktop, claude.ai), and as a local HTTP JSON API. | Should | 3 |

The CLI:

| Command | What it does | Exit codes |
| --- | --- | --- |
| `agentctl status "<text>"` | Sets the agent's one-line activity. | 0 |
| `agentctl next "<step>" --resource <name> --in <seconds>` | Announces a disruptive step that's coming up. | 0 |
| `agentctl guard <resource> --action close [--wait <seconds>]` | Checks the resource is free before a close, launch or restart. `--wait` waits for a release. | 0 free, 3 held, 4 manager not running |
| `agentctl launch <resource> -- <command>` | Starts an app and records that this agent started it. | the app's own |
| `agentctl job start "<name>" --log <file> --estimate <seconds>` | Starts tracking a long job. | 0 |
| `agentctl job end --ok` or `--failed "<reason>"` | Ends the job and sends the notification. | 0 |
| `agentctl lock <resource> [--wait <seconds>]`, `agentctl unlock <resource>` | Takes or gives back an exclusive lease. | 0 taken, 3 queued or held |
| `agentctl output <file-or-url> --caption "<text>" [--ready]` | Attaches a screenshot, link, log or build. `--ready` puts it on "Ready for you". | 0 |
| `agentctl holds` | Lists the holds and locks on this project. | 0 |

Each project adds the rules to its agent instructions (CLAUDE.md):

```markdown
## Agent Manager
- Before closing, launching or restarting anything in .agent-manager/resources.json,
  run `agentctl guard <name>`. Exit 3 means the person holds it: do other work, or
  wait with --wait. Never work around a hold.
- Start those apps with `agentctl launch`, so the manager knows you started them.
- Announce a disruptive step as soon as you know it's coming:
  `agentctl next "<step>" --resource <name> --in <seconds>`.
- Wrap anything over a minute in `agentctl job start` / `agentctl job end`, with an estimate.
- Attach what the person should check with `agentctl output <file> --ready`.
```

## Where the data comes from

Claude Code already exposes nearly everything the manager needs, so the manager combines its hooks, its session list and each session's inbox instead of reading windows or screens. The facts below come from the Claude Code docs (see Sources), plus a check on one Windows 11 PC running VS Code extension 2.1.295 on 2026-10-09.

| Need | Claude Code source | Status |
| --- | --- | --- |
| Which sessions exist, and their state | SessionStart hook (with `source`, `model`, `session_title`) and SessionEnd hook. Also the session list behind `/list-agents`. | The list was seen working here: 7 local sessions (VS Code and terminal), each idle, waiting or busy. How a program outside Claude reads it isn't documented (Q-01). |
| What each agent is doing | PreToolUse, PostToolUse and PostToolUseFailure hooks, with `tool_name`, `tool_input` (shell calls carry a `description`) and `tool_use_id`. Hooks of type `http` POST the event to a local URL. | Documented |
| What's waiting on the person | Notification hook types `permission_prompt`, `idle_prompt`, `agent_needs_input` and `elicitation_dialog`. | Documented |
| Blocking a call (holds, pause) | PreToolUse returns `permissionDecision: "deny"` with a reason, or exits 2. `"continue": false` with a `stopReason` ends the turn. Hooks time out after 600 s by default, and the timeout can be set per hook. | Documented |
| Answering a prompt from the inbox | The PermissionRequest hook returns `decision.behavior` set to `allow` or `deny`. | Documented, untested (Q-04) |
| Messages to an agent | Each session's inbox: a named pipe on Windows, whose path and auth token reach hooks as `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`. A message arrives between tool calls, or starts a turn if the session is idle. | Documented; the pipe variable is set in sessions here (Q-05) |
| The session id in an agent's shell | A SessionStart hook writes variables to `CLAUDE_ENV_FILE`. | Documented with bash examples only (Q-06) |
| Background sessions | Agent View: `claude agents --json` (id, state, status, waitingFor, cwd, pid, sessionId, name). | Documented. The `claude` on PATH here is 2.1.63, older than the extension, and needs updating (Q-08). |
| History, usage, cost | The session transcript at `transcript_path` (JSONL). OpenTelemetry with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, where prompts and tool details are redacted by default. | Documented |
| Phone | Remote Control (claude.ai/code and the Claude app), with push notifications when action is needed. `CLAUDE_CLIENT_PRESENCE_FILE` skips pushes while the person is at the machine. | Documented |
| claude.ai chats | No hooks. The only way in is an MCP connector, which needs an HTTPS endpoint reachable from the internet. | Phase 3 |

What already exists, and what it leaves out:

| Claude Code feature | Already does | Doesn't do |
| --- | --- | --- |
| Agent View (`claude agents`) | One screen for background sessions: state, a one-line summary, peek, attach, stop, notifications. | Interactive VS Code windows (until they're backgrounded), answering permission prompts inline, pause, holds. |
| Remote Control | Drives one session from a phone or browser, prompts included, with push notifications. | One combined view, holds, locks. |
| Cross-session messaging | Agents message each other, and ask for a notice when a session goes idle. | Anything the person controls. |

The manager links to Agent View and Remote Control for conversation, and builds what none of them has: holds, pause, one board for every session, and outputs.

## Screens

The board is the home screen. The other views go deeper on one agent, one resource or one list.

&#91;embedded content: board mock-up · scenario 1, two projects\]

The moment shown is scenario 1: the person is recording, so the game is held. One agent waits for it, and another has its next step queued behind the hold.

1. **Board** (home). A top bar with the Do not disturb switch, counts (working, waiting, blocked) and Pause all. A "Waiting on you" strip is pinned under it. Below that, agent cards grouped by project, each with a name, surface, state colour, one-line activity, elapsed time, Next up with a countdown and Hold, and the latest output's thumbnail.
2. **Agent detail**. The timeline, the current job with its log tail, outputs, and the controls: Pause, Resume, Stop, Message, Open window, plus Open in Agent View or Remote Control where those apply.
3. **Resources and holds**. Each resource with whether it's in use and who started it, its hold switch and end time, and the lock owner and queue.
4. **Inbox**. Requests, newest first, with Allow and Deny where Claude Code supports them and Open window everywhere.
5. **Ready for you**. Outputs marked ready, grouped by project, with thumbnails and the agent that made them.
6. **Phone** (phase 2). The inbox, a compact board, and the Do not disturb switch.
7. **Tray**. The icon's colour shows the worst state (red failed or refused, amber waiting on the person or blocked, green working). Its menu has Do not disturb, Pause all and Open board.

## Acceptance scenarios

Each phase is done when its scenarios pass on the person's own PC, with real Claude Code sessions doing real work. Scenarios 1–5 and 8 close phase 1; 6, 7 and 9 close phase 2.

1. **Recording a demo** (H-02, H-03, H-04, D-13). The person holds the game with the reason "recording" for 45 min. An agent finishes an import and runs its relaunch script. The call is denied, and the agent's card reads "Blocked: game held by you (recording, 32 min left)". No sound plays. The person releases the hold, and within 5 s the agent is told and retries.
2. **An app the person started** (H-05, D-08). The person starts the game from a desktop shortcut. An agent runs `agentctl guard game --action close`, which exits 3. An inbox request appears: "musik-4a wants to close Musik.exe, which you started." Deny keeps the agent off it; Allow once lets that one close through.
3. **Heads-up** (D-07, H-06). An agent's next call would close the game, which has `warnSeconds: 60`. A toast says "musik-4a will close Musik in 60 s" with a Hold button. The person clicks Hold, and the call is denied.
4. **Pause all** (D-04, D-05). Three agents are working, one of them 23 min into a 60-min import. The person clicks Pause all. No agent starts a new tool call. The import keeps running, and its card reads "Pausing after: Import (37 min left)" with a Kill button. Resume all sets every agent going within 5 s, with no typing in their windows.
5. **A prompt in a hidden window** (D-08, D-13). An agent in a background VS Code window hits a permission prompt. Within 5 s a toast appears, and the inbox shows the exact command and the project. A click focuses that window (phase 1) or allows the call (phase 2).
6. **A long job** (D-03, D-13). An agent starts an import with a 60-min estimate. Its card shows elapsed time, the estimate and the log tail. When the import fails, a toast shows the last error line.
7. **Two agents, one lock** (H-08, H-09). Agent A holds the lock "editor-content" for an import. Agent B runs `agentctl lock editor-content --wait 1800`, and its card reads "Waiting for editor-content (held by A, about 12 min)". When A unlocks, B has the lock within 5 s. If A crashes, the lock is freed after 2 min.
8. **Manager down** (H-07). With the manager's process killed, guarded calls are refused with "Agent Manager not running", other calls run normally, and no tool call takes more than 100 ms longer.
9. **Inside the app** (D-15). A VR game polls the read API every 2 s and shows "2 agents working; musik-4a wants to restart the game in 3 min" on an in-game screen, with a Hold button. Pressing it sets the hold, and the board shows it within 2 s.

## Non-functional

Every tool call of every agent passes through the manager's hook, so it has to be fast, always on, and invisible when nothing is held.

| Area | Requirement |
| --- | --- |
| Platform | Windows 11 first: named pipes, PowerShell, the VS Code extension. macOS and Linux later. Starts at login as a tray app or service. |
| Hook speed | Under 50 ms median and 200 ms at the 99th percentile for each hook call, measured inside the agent's tool call. |
| Freshness | The board is no more than 2 s behind any event. A hold takes effect at each agent's next tool call. |
| Footprint | Under 150 MB of memory and close to 0% CPU while idle. |
| Scale | 20 agents at once, 50,000 events a day, 30 days of history. |
| Reliability | Holds and locks are saved to disk and survive a restart. A crashed manager is restarted within 5 s. Guarded steps fail closed while it's down (H-07). |
| Errors | No silent fallbacks: every failure shows on the board, or to the agent as a non-zero exit with a reason. |
| Network | Listens on 127.0.0.1 only in phase 1, and works offline. Phone or LAN access (phase 2) needs a sign-in and HTTPS. |
| Control | Pause, Stop, release, Allow and Kill require the signed-in person. Apps using the read API (D-15) get a token that can read status and set holds, but nothing else. |
| Privacy | Stored by default: tool names, descriptions, durations and exit codes. Prompts, tool output and file contents are stored only if the person opts in. Session inbox tokens never leave the machine. A phone sees status lines and outputs marked ready, nothing more. |

## Phases

Phase 1 is the commitment: everything a single PC needs to see agents, hold things and pause. No dates are set yet; the team estimates phase 1 after the open questions are answered.

&#91;embedded content: roadmap · three phases, two gates\]

## Open questions

The team settles these with small spikes before phase 1 is built. Q-02 and Q-05 decide how pause and resume work.

- [ ] **Q-01 Session list.** Can a program outside Claude read the local session list that `/list-agents` shows (name, idle, waiting or busy, folder)? If not, build the registry from SessionStart and SessionEnd hooks plus process checks.
- [ ] **Q-02 Pause.** Is holding a PreToolUse hook open for up to 10 min acceptable (600 s is the default timeout for command and http hooks)? Past that, end the turn with `"continue": false` and resume through the session's inbox. Check both in the VS Code extension.
- [ ] **Q-03 Stop.** The docs show no way to interrupt a model turn from outside, only to stop it at its next tool call. Confirm, and say so on the Stop button if that's the case.
- [ ] **Q-04 Remote approval.** Can a PermissionRequest hook wait minutes for the person's answer from the inbox, and does the normal dialog still show in the window meanwhile?
- [ ] **Q-05 Posting to an inbox.** On Windows, posting needs the session's `CLAUDE_CODE_MESSAGING_TOKEN`. Can a SessionStart hook hand it to the manager safely? Is a message from the manager delivered or held under each permission mode?
- [ ] **Q-06 Session id in PowerShell.** The docs show `CLAUDE_ENV_FILE` with bash `export` lines. Does a variable set there reach the PowerShell tool in the VS Code extension?
- [ ] **Q-07 Hook scope.** Hooks in user settings apply to every project. Can a project's settings switch the guard hook off? If so, install it through managed settings.
- [ ] **Q-08 CLI version.** Update the `claude` CLI on PATH (2.1.63 here) so that Agent View and `claude agents --json` are available.
- [ ] **Q-09 More machines.** Is there one manager per machine, or one per person across machines (phase 3)?
- [ ] **Q-10 Other tools.** Should holds cover agents other than Claude (Copilot, Cursor, plain scripts) beyond `agentctl guard`, which any script can already call?

## Sources

All pages read on 2026-10-09.

- [Hooks reference](https://code.claude.com/docs/en/hooks): events, input fields, decisions, timeouts, HTTP hooks, `CLAUDE_ENV_FILE`.
- [Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging): the session list, inboxes, named pipes on Windows, inbound controls.
- [Agent view](https://code.claude.com/docs/en/agent-view): background sessions, `claude agents --json`, notifications.
- [Remote Control](https://code.claude.com/docs/en/remote-control): phone and browser control, push notifications, `CLAUDE_CLIENT_PRESENCE_FILE`.
- [Monitoring usage](https://code.claude.com/docs/en/monitoring-usage): OpenTelemetry metrics, events and redaction.
- The local check: `/list-agents` from a VS Code session (extension 2.1.295) on Windows 11, and `claude --version` on PATH.
