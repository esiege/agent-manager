# Sending prompts to agents from the UI: findings

Oct 11, 2026 · Shelved, then picked up again the same day as an MVP (see "The MVP" below)

The question: can the owner type a prompt on an agent's page in Agent Manager and have it reach that Claude Code session? We looked into it, then shelved it. This page records what we learned so the work doesn't have to be redone. It answers most of [Spec.md](Spec.md) Q-05 and stays outside v1, as [Spec-v2.md](Spec-v2.md) planned ("Talking to agents" is a non-goal).

## Summary

- It's possible. Claude Code gives each session an inbox, a named pipe on Windows, and a program that holds the session's token can post text into it. The text arrives between tool calls, or starts a new turn if the session is idle.
- The manager can't do it on its own today. All traffic goes one way: agents POST to Azure, and nothing comes back. Three pieces would need to be added:
  - a message queue in the API
  - a poll from each PC's `agentctl daemon`
  - delivery to the session's pipe on that PC
- The feature would turn the manager into a remote control for every PC, so the main cost is security, not code.
- We shelved it. Claude Code's auto mode refused the live delivery test because it would have a Claude session posting into its own inbox. The owner decided not to continue. **Nothing was built, and delivery on Windows has not been tested.**

## Ways to deliver a message

| Option | Verdict |
| --- | --- |
| **Session inbox** (`CLAUDE_CODE_MESSAGING_SOCKET`) | **Best fit.** It works in every session with nothing to opt into, including VS Code. It can start a turn in an idle session. |
| **Hooks.** A Stop hook returns `decision: "block"` with the message as the reason, or PreToolUse returns `additionalContext`. | Fallback only. Hooks fire only while the agent is working, so they can't wake an idle session. |
| **Channels** (an MCP server that pushes events) | Doesn't fit. The session needs `--channels` at startup, and during the research preview only allowlisted plugins can register (custom ones need `--dangerously-load-development-channels`). That rules out VS Code sessions started the normal way. |
| **Remote Control** | Already exists and sends real prompts. It's separate from the manager. |

## The inbox protocol

The sources are the [cross-session messaging docs](https://code.claude.com/docs/en/cross-session-messaging) and a log line built into Claude Code 2.1.296 (the VS Code extension's `claude.exe`), which prints a recipe for posting to the inbox.

- **Address.** Claude Code exports `CLAUDE_CODE_MESSAGING_SOCKET` to hooks and Bash commands, before `SessionStart` runs. On native Windows it's a named pipe. You can also see it in the `Peer address` row of `/status`.
- **Token.** It's in `CLAUDE_CODE_MESSAGING_TOKEN`, which is exported the same way.
- **Two lines of JSON.** Native Windows requires the auth line first, and closes any connection that sends something else first. The recipe writes:

  ```
  {"type":"auth","token":"<CLAUDE_CODE_MESSAGING_TOKEN>"}
  {"type":"user","message":{"role":"user","content":"hello"}}
  ```

  The recipe in Node:

  ```
  node -e "const c=require('net').connect(process.argv[1],()=>{c.write(JSON.stringify({type:'auth',token:process.env.CLAUDE_CODE_MESSAGING_TOKEN})+'\n'+JSON.stringify({type:'user',message:{role:'user',content:'hello'}})+'\n');c.end()})" "<socket>"
  ```

- **Timing.** Open the connection only when the message is ready. A connection that sends no complete line within 30 s is closed.
- **Limits.**
  - Plain text only.
  - Messages over about 1 million characters are refused.
  - Rapid bursts to one session are refused, and repeats are rate-limited per sender.
  - At most 50 accepted messages wait in the queue.
  - At most 100 held messages are kept, after which the oldest are dropped.
- **Inbound controls.** The receiving session's `crossSessionInbound` setting (`accept`, `hold` or `refuse`) decides what happens to each message. With no setting, a session in bypass-permissions mode holds messages for approval. VS Code sessions can't show the approval dialog, so held messages expire there after `dialogExpiry`, which defaults to 5 minutes.

## How a message is trusted (important)

- The token exported to hooks is the session's "own child" token. In the binary, the exported value is `childToken`.
- On native Windows, holding that token is the only way Claude Code recognises a sender as one of the session's own child processes.
- When no `crossSessionInbound` value applies, own-child messages are delivered. That includes sessions in bypass-permissions mode, where messages from other sessions would normally be held.
- So a daemon that posts with the token counts as part of the session itself, and the built-in hold for bypass-permissions sessions does not protect us. The manager would have to refuse those sessions itself.
- **Confirmed Oct 12, 2026 (see The MVP):** an own-child message still arrives labelled as a message from another session, not as the owner's prompt. Before that test, this was an open question: A message from another session is labelled "not from you": it can't approve permission prompts, can't change settings, and slash commands in it don't run. An own-child message may look like the owner's own prompt. This decides how strict the guard rails need to be.

## Security

### What the manager allows today

These were checked in the code on Oct 11, 2026:

- Every page needs sign-in. The only public files are `/agentctl.js` and `/instructions.md`.
- Every API handler checks the caller itself:
  - The 7 owner handlers call `requireOwner`, which compares the GitHub login against `OWNER_LOGINS`.
  - The 3 agent handlers call `requireKey`.
- The API runs as Static Web Apps managed functions; `infra/main.bicep` has no separate Function App. Static Web Apps sets `x-ms-client-principal` itself, so a caller can't fake it.
- Machine keys can only write reports. Nothing the manager does today changes anything on a PC.

### What changes if the manager can send prompts

Breaking into the manager would no longer just leak activity. It would let someone run Claude Code, and so commands, on every PC as the owner, with no prompts in auto or bypass-permissions sessions.

| Way in | Mitigation |
| --- | --- |
| The owner's GitHub account (the only login) | Turn on 2FA on GitHub. Optionally, ask for a passkey tap on each send. |
| CSRF: a page the owner visits while signed in POSTs to the send endpoint | Accept only `application/json` with a custom header such as `X-Agent-Manager-Owner: 1`. |
| Machine keys, which every agent shell can read through `AGENT_MANAGER_KEY` | Machine keys must never create messages. Otherwise one agent hit by prompt injection could steer the others. |
| Azure portal, deploy or Cosmos access | Sign each message end to end (below). |

### Guard rails we planned

- **Signing.** The browser holds an Ed25519 key that can't be exported, or a passkey. Each PC stores the owner's public key in `~/.agent-manager/config.json` at install time. Each message is signed over `{agentId, text, id, expiresAt}`. The daemon checks the signature, the expiry, that it hasn't seen the `id` before, and that the agent is a live session on that machine. With this, a breach in Azure can't run anything on a PC.
- **Off by default.** Each PC turns it on with `agentctl install --allow-messages`. The server can't switch it on.
- **The pipe token never leaves the PC.** The SessionStart hook saves it in `~/.agent-manager/sessions/<id>/`, and only the daemon reads it.
- **Refuse sessions in `bypassPermissions` mode.** `permissionMode` is already in the agent's `details`.
- **Short expiry.** Expire undelivered messages after about 10 minutes and delete delivered ones from Cosmos. That keeps the README's promise that prompts aren't stored.
- **Audit.** Each send appears on the agent's timeline with the sender's login. The daemon logs it locally as well.
- **Kill switch.** `agentctl messages off` stops delivery on a PC.

### Worth checking anyway

`POST /api/v1/keys` and `/keys/revoke` already change state using only the sign-in cookie. We didn't check the `SameSite` setting on the Static Web Apps cookie, or whether those handlers require a JSON content type. The worst cross-site case is revoking keys, because the new key's secret comes back in a response another site can't read. The custom header above would close this as well.

## The MVP

Built on Oct 11, 2026. It follows the design on this page, without signing.

| Part | What it does |
| --- | --- |
| API, `api/src/handlers/messages.ts` | **Owner `POST /api/v1/messages`** takes `{agentId, text}` (at most 4,000 characters). It only accepts a running, top-level Claude Code session that isn't in `bypassPermissions` mode. The message expires after 10 minutes.<br>**Machine-key `POST /api/v1/inbox`** returns waiting messages, but only to the key that reports the agent.<br>**Machine-key `POST /api/v1/inbox/ack`** records whether a message was delivered or failed. A repeated ack changes nothing.<br>Sends and acks appear in the agent's timeline. Messages live in the Cosmos `messages` container (partitioned by `/machine`) for one day. |
| CSRF | Owner POSTs, including keys and alerts, now need the `x-agent-manager-owner: 1` header. The UI sends it on every change. |
| agentctl | Off unless `agentctl install --allow-messages`; `--no-messages` turns it off again.<br>While it's on, each hook keeps `sessions/<id>/inbox.json` up to date: the socket, the token and the latest permission mode. The file is deleted at SessionEnd, when messages are turned off, and by `uninstall`.<br>The heartbeat polls `/inbox` every 5 s while some open session has an inbox file. It posts each message with the two lines above, adds "(Sent from Agent Manager by <login>)" to the end, and acks. It refuses bypass-permissions sessions itself as well.<br>`agentctl doctor` shows whether messages are on and how many sessions can take one. |
| UI | The agent page gets a "Message this session" box (Ctrl+Enter sends) with the latest 20 messages and their status: waiting, posted, not delivered or expired. |

Tests: `api/test/api.test.ts` ("messages to agents") and `reporter/test/inbox.test.ts`. The inbox tests include a real round trip over a local named pipe.

**Tested live on Oct 12, 2026** (Claude Code 2.1.296, VS Code extension, Windows 11). The owner sent "Does this work?" from the agent page to an idle session on the same PC:
- **Delivered.** The heartbeat posted it about 5 s after it was sent, and acked it as delivered. It started a new turn in the idle session.
- **Labelled as a peer message, not as the owner's prompt.** Claude Code presented it as "Another Claude session sent a message… not typed by your user". The receiving Claude is told it can't approve anything or change settings because of it. So the own-child token gets the message delivered without a hold, but it doesn't give the message the owner's authority. That's the safer of the two outcomes.
- The footer "(Sent from Agent Manager by esiege)" came through, which tells the session and the person at the window where it came from.

Still true: Claude Code doesn't answer on the pipe, so "posted" means the pipe took the lines. A wrong token would be dropped without any error.

### Trying it

1. Deploy the API and site.
2. On the PC, rebuild or download `agentctl.js`, then run `node agentctl.js install --allow-messages`.
3. Open a new Claude Code session, or send a prompt in an open one so a hook writes its inbox file. `agentctl doctor` should then count it.
4. On that session's page, type a short harmless message and send it. Within about 5 s its status should change to "Posted to the session", and the text should show up in the session.

## If this is picked up again

1. Run the delivery test in a terminal Claude Code session, typed with the `!` prefix so the owner runs it:

   ```
   ! node -e "const c=require('net').connect(process.env.CLAUDE_CODE_MESSAGING_SOCKET,()=>{c.write(JSON.stringify({type:'auth',token:process.env.CLAUDE_CODE_MESSAGING_TOKEN})+'\n'+JSON.stringify({type:'user',message:{role:'user',content:'Agent Manager inbox test'}})+'\n');c.end()})"
   ```

   Check that it arrives, and whether Claude treats it as the owner's prompt or as a message from another session.

2. Build the pieces:
   - a `messages` store and an owner `POST /api/v1/agents/message`
   - pending messages returned on `/heartbeat`, or from a machine-key `GET /api/v1/inbox`
   - the daemon polling every 5–10 s while sessions are live (it beats every 60 s today)
   - the SessionStart hook saving the socket and token
   - delivery through the pipe
   - a send box on `AgentDetailPage`

3. Add the guard rails above. Signing can come last without changing the rest.
4. Work on this with Claude Code outside auto mode. Its safety check counts this work as one Claude session steering another and blocks it.

## Sources

Read on Oct 11, 2026.

- [Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging): the inbox, the auth line, own-child messages, `crossSessionInbound`, limits.
- [Channels](https://code.claude.com/docs/en/channels): `--channels`, allowlists, research preview.
- Claude Code 2.1.296 `claude.exe` (VS Code extension): the `[uds-messaging]` log lines, with the Node recipe and the `childToken` export.
