# Agent Manager: update to the latest

Updated: **2026-10-11** · Instructions version: **2**

You are an AI agent on a PC that already reports to Agent Manager, and the person wants this PC on the latest version. This page tells you how. It takes a minute and changes nothing else on the PC. (Setting up a new PC? Use `$MANAGER_URL/instructions.md` instead.)

## If this was sent to you: check for an update first

Run:

```bash
node "$HOME/.agent-manager/agentctl.js" version
```

- It prints `agentctl, instructions version 2 (2026-10-11)` or a later version or date: this PC is up to date. Only check step 5 below (the `CLAUDE.md` section), then tell the person "Already up to date" and stop.
- It prints an older version, a version without a date, or nothing (the file is missing): follow the steps below. If the file is missing, this PC was never set up: follow `$MANAGER_URL/instructions.md` instead.

- **`$MANAGER_URL`** below means the address you fetched this page from, without `/update.md` (for example `https://agents.example.net`).
- If a tool gave you a summary of this page, fetch the raw file (`curl -fsSL $MANAGER_URL/update.md`) so you have the exact commands.
- **The machine key is a secret.** It is never on this page and the update doesn't need it on the command line: `install` reuses the saved one. Don't print it, log it or write it anywhere.

## What's new in version 2

- Each session reports its **story** (the ticket in the branch name with the session's title), its **task** (what it's doing now) and the person's latest **prompt**.
- When a request ends with a new commit, the session reports the **finished work**: the commit's subject and link, the prompt, a summary, and what the person should see now. Agents can write a better one with `agentctl done`.
- Requests that never finish (an API error, a closed session, a lost connection) show as **unfinished**.

## Claude Code

1. Check this PC is set up: `node "$HOME/.agent-manager/agentctl.js" doctor` should show a config and `Hooks: installed`. If the file isn't there, stop and follow `$MANAGER_URL/instructions.md` instead.
2. Download the latest agentctl over the old one.

   PowerShell:
   ```powershell
   Invoke-WebRequest "$MANAGER_URL/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
   ```
   bash or zsh:
   ```bash
   curl -fsSL "$MANAGER_URL/agentctl.js" -o "$HOME/.agent-manager/agentctl.js"
   ```
3. Install it again. This keeps the saved URL, key and machine name, refreshes the hooks in `~/.claude/settings.json` (after backing it up), and restarts the heartbeat on the new version.
   ```bash
   node "$HOME/.agent-manager/agentctl.js" install
   ```
4. Check:
   - `node "$HOME/.agent-manager/agentctl.js" version` says `instructions version 2`.
   - `node "$HOME/.agent-manager/agentctl.js" doctor` shows `Hooks: installed` and `Connection: OK`.
5. Update the `## Agent Manager` section of the user's `~/.claude/CLAUDE.md` (and of the project's `CLAUDE.md`, if it has one) to the text below. Replace the old section rather than adding a second one; add it if there is none. Leave the rest of the file alone.

   ```markdown
   ## Agent Manager
   - When you start on a story or ticket, run
     `node "$HOME/.agent-manager/agentctl.js" story "<KEY-123: the story's title, or one line on the goal>"`.
   - When you finish a request that changed files: commit it (one commit, with a clear subject: it
     becomes the report's name), then report it:
     `node "$HOME/.agent-manager/agentctl.js" done "<2 to 5 short Markdown bullets: what you did>" --check "<what the person should see now>" --check "..."`
     Keep the checks few and concrete: where to look, and what they'll see there.
   - Keep everything short and plain. Never include secrets, file contents or command lines.
   ```
6. Tell the person it's done. Sessions that are already open pick up the new version at their next step; there's nothing to restart. On the Agents tab, this PC's sessions lose their "old setup" badge once they report again.

### If you can't finish the update yourself

Claude Code in auto mode won't let an agent change Claude Code's own settings, so step 3 may be blocked. That's expected: don't try to work around it. Do step 2 if you're allowed to, then give the person these commands to run in their own PowerShell window (a VS Code terminal works), filled in and as one code block:

```powershell
Invoke-WebRequest "<$MANAGER_URL>/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
node "$HOME\.agent-manager\agentctl.js" install
node "$HOME\.agent-manager\agentctl.js" doctor
```

Then do step 5 yourself if you can, or show the person the new section to paste.

## Any other agent or service

Nothing to install. Version 2 adds optional report fields: `story`, `task`, `prompt`, `turn` (`start` and `end` of a request) and `result` (the report of finished work). See "Report" in `$MANAGER_URL/instructions.md` for what each one means, start sending the ones that fit, and send `"instructionsVersion": 2` with your reports.
