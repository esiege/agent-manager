# Agent Manager: how to report in

Instructions version: **1**

You are an AI agent (Claude Code, OpenClaw, or something else) and the person you work for wants you to report to their Agent Manager. This page tells you how. Follow the section for your kind of agent, then run its check at the end.

- **`$MANAGER_URL`** below means the address you fetched this page from, without `/instructions.md` (for example `https://agents.example.net`).
- If a tool gave you a summary of this page, fetch the raw file (`curl -fsSL $MANAGER_URL/instructions.md`) so you have the exact commands.
- **The machine key is a secret.** It is never on this page. Read it from the `AGENT_MANAGER_KEY` environment variable. Don't print it, log it or write it into files other than the ones these steps name. If it isn't set, stop and ask the person to make a key on the **Settings** tab of Agent Manager and save it as `AGENT_MANAGER_KEY`.
- Never send prompts, file contents, command lines, tool output or anything secret to Agent Manager. Send short status lines only.

## Claude Code

One-time setup per PC. It installs a small reporter (`agentctl`) that Claude Code runs from hooks, so every session on this PC reports on its own from then on. Nothing for you to remember afterwards.

1. Check Node.js 18 or newer is installed: `node --version`. If not, stop and tell the person.
2. Download agentctl.

   PowerShell:
   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.agent-manager" | Out-Null
   Invoke-WebRequest "$MANAGER_URL/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js"
   ```
   bash or zsh:
   ```bash
   mkdir -p "$HOME/.agent-manager" && curl -fsSL "$MANAGER_URL/agentctl.js" -o "$HOME/.agent-manager/agentctl.js"
   ```
3. Install it. This checks the URL and key with Agent Manager first, then adds hooks to `~/.claude/settings.json` (after backing it up). Claude Code may ask the person to approve the settings change.
   ```bash
   node "$HOME/.agent-manager/agentctl.js" install --url "$MANAGER_URL"
   ```
   On Windows it also finds a key saved for the user even if your shell started before it was saved. Add `--machine <name>` to choose how this PC is named (default: its host name).
4. Check: `node "$HOME/.agent-manager/agentctl.js" doctor` should show the config, `Hooks: installed` and `Connection: OK`.
5. Tell the person it's done: new Claude Code sessions on this PC appear at `$MANAGER_URL/agents` within a few seconds. Sessions already open start reporting once Claude Code reloads its settings (starting a new session always works).

### If you can't finish setup yourself

Claude Code in auto mode won't let an agent change Claude Code's own settings (it calls this self-modification), so step 3 may be blocked. That's expected: don't try to work around it, and don't hand it to another agent, because any agent in auto mode hits the same block. Do steps 1 and 2 if you're allowed to, then give the person these commands to run in their own PowerShell window (a VS Code terminal works), filled in and as one code block:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agent-manager" | Out-Null
Invoke-WebRequest "<$MANAGER_URL>/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
node "$HOME\.agent-manager\agentctl.js" install --url "<$MANAGER_URL>"
node "$HOME\.agent-manager\agentctl.js" doctor
```

Tell them: the key must already be saved as `AGENT_MANAGER_KEY` (made on the Settings tab); install finds it on its own, so it never goes on the command line; and `doctor` should show `Hooks: installed` and `Connection: OK`. Use the bash commands from step 2 instead if this PC isn't Windows.

Optional: to let agents add a one-line summary of what they're working on, add this to the project's or the user's `CLAUDE.md`:

```markdown
## Agent Manager
When you start a task, and before any step that takes more than a few minutes, run
`node "$HOME/.agent-manager/agentctl.js" status "<one line: what you're doing>"`.
Keep it short and plain. Never include secrets, file contents or command lines.
```

To remove it: `node "$HOME/.agent-manager/agentctl.js" uninstall`.

## OpenClaw

Each persona (for example the community manager for the website, and the one for the game) reports as its own agent. Use your own way of making HTTP calls (a skill, a tool or a script) and your scheduler for the heartbeat.

- **agentId**: `openclaw/<persona>`, for example `openclaw/community-web`. Keep it the same across restarts.
- **kind**: `openclaw`. **machine**: the host you run on. **name**: the persona's display name.
- **Every 2 minutes**, and whenever your state changes, send a report with `state` and a one-line `activity`. Set `"lostAfterSeconds": 300` so Agent Manager shows you as Lost after 5 minutes of silence.
- **Every public action** (posted patch notes, answered a comment, ran a survey) is a report with `link` set to what you posted, and `activity` saying what you did.
- Send errors and anything worth troubleshooting to `/api/v1/logs` with `source` set to your agentId.

See "Any other agent or service" for the exact calls.

## Any other agent or service

Two calls cover most agents: **report** your state, and send **logs**. Every call is a `POST` with the header `X-Agent-Manager-Key: $AGENT_MANAGER_KEY` (not `Authorization`, which the host replaces) and a JSON body. Answers are JSON. A refused call returns 4xx with `{"error": "<one line saying what to fix>"}`. Add `"test": true` to any call to check it without storing anything.

### Report: `POST $MANAGER_URL/api/v1/report`

| Field | Required | Meaning |
| --- | --- | --- |
| `agentId` | yes | Stable id for you, unique across everything that reports (up to 200 characters). |
| `kind` | yes | `claude-code`, `openclaw`, `service` or `other`. |
| `machine` | yes | The PC or host you run on. |
| `name` | no | Display name. Defaults to `agentId`. |
| `project` | no | The project or product you work on. |
| `parentId` | no | The `agentId` of the agent that started you, if you are a sub-agent. |
| `state` | no | `working`, `waiting` (waiting on the person), `idle`, `stopped` or `failed`. Agent Manager works out `lost` itself from silence. |
| `activity` | no | One line: what you're doing now (up to 500 characters). |
| `link` | no | An http(s) link to something you made or posted. |
| `details` | no | Any other JSON you want shown. Unknown top-level fields are kept here too. |
| `lostAfterSeconds` | no | How long silence means Lost. Default 180. |
| `instructionsVersion` | no | The version at the top of this page, so the person can see who is out of date. |
| `at` | no | ISO 8601 time it happened. Defaults to when it arrived. |

Report when you start, when your state changes, and at least every couple of minutes while you run. Send `"state": "stopped"` when you finish.

curl:
```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/report" \
  -H "X-Agent-Manager-Key: $AGENT_MANAGER_KEY" -H "Content-Type: application/json" \
  -d '{"agentId":"openclaw/community-web","kind":"openclaw","machine":"claw-host","name":"Community manager (web)","state":"working","activity":"Answering new comments","lostAfterSeconds":300,"instructionsVersion":1}'
```

PowerShell:
```powershell
$body = @{ agentId = 'gma/functions'; kind = 'service'; machine = 'azure'; name = 'Game Master Assistant'; state = 'working'; activity = 'Serving requests'; instructionsVersion = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Post "$MANAGER_URL/api/v1/report" -Headers @{ "X-Agent-Manager-Key" = $env:AGENT_MANAGER_KEY } -ContentType 'application/json' -Body $body
```

Python:
```python
import json, os, urllib.request

def report(manager_url: str, **fields) -> dict:
    req = urllib.request.Request(
        f"{manager_url}/api/v1/report",
        data=json.dumps(fields).encode(),
        headers={"X-Agent-Manager-Key": os.environ['AGENT_MANAGER_KEY'], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)

report("https://agents.example.net", agentId="openclaw/community-game", kind="openclaw", machine="claw-host",
       state="working", activity="Posted patch notes for 1.4", link="https://example.com/news/1-4", instructionsVersion=1)
```

The answer includes `agentUrl`, the agent's page in Agent Manager, and `warnings` for anything that was adjusted (for example a field that was too long).

### Logs: `POST $MANAGER_URL/api/v1/logs`

Body: `{"entries": [ ... ]}` with up to 500 entries per call (1 MB at most). Each entry:

| Field | Required | Meaning |
| --- | --- | --- |
| `level` | yes | `debug`, `info`, `warn` or `error` (`warning`, `fatal` and similar are mapped). |
| `source` | yes | What sent it, for example `gma-web` or your `agentId`. |
| `message` | yes | The log line (up to 8,000 characters). |
| `at` | no | ISO 8601 time. Defaults to when it arrived. |
| `agentId` | no | The agent it belongs to, so it shows on that agent's page. |
| `correlationId` | no | Ties together the lines of one request or job. |
| `context` | no | Any JSON that helps troubleshooting. Unknown fields are kept here too. |

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/logs" \
  -H "X-Agent-Manager-Key: $AGENT_MANAGER_KEY" -H "Content-Type: application/json" \
  -d '{"entries":[{"level":"error","source":"gma-web","message":"Encounter generator timed out after 30 s","correlationId":"req-81f2","context":{"route":"/api/encounter"}}]}'
```

Values that look like keys or tokens are masked when stored, but don't rely on it: never log secrets.

### Heartbeat for many agents: `POST $MANAGER_URL/api/v1/heartbeat`

If one process watches several agents of one kind on a machine, it can send `{"machine": "...", "kind": "...", "agentIds": ["...", "..."]}` every minute instead of a report per agent. Listed agents stay alive. Agents of that machine and kind that aren't listed are marked stopped. Ids Agent Manager has never seen come back in `stored.unknown`, so you can send a full report for each.

## Check that it works

Send a test report. It is checked but not stored:

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/report" \
  -H "X-Agent-Manager-Key: $AGENT_MANAGER_KEY" -H "Content-Type: application/json" \
  -d '{"agentId":"setup-check","kind":"other","machine":"'"$(hostname)"'","test":true}'
```

A working setup answers `{"ok":true,"test":true,...}`. A 401 means the key is missing, wrong or revoked: ask the person for a new one from the Settings tab. Then send one real report and tell the person where to see it (the `agentUrl` in the answer).
