# Connect a PC to Agent Manager Delux

Do this once on each PC. After that, every Claude Code session on that PC reports to Agent Manager Delux automatically, in any project, in VS Code or a terminal. There's nothing to do per session or per project, because the hooks go in your user-level `~/.claude/settings.json`.

You run the install yourself. Claude Code in auto mode blocks every agent, including a DevOps agent, from changing Claude Code's own settings. So asking an agent to install it will end with the agent handing you these same commands.

## Steps, once per PC

1. **Make a key.** On the Keys tab of Agent Manager Delux, make a machine key named after the PC, for example `pc-studio` or `pc-laptop`.
2. **Save the key.** On that PC, run the PowerShell line the tab shows. It saves the key as `AGENT_MANAGER_KEY` for your Windows user. The tab shows the key only once, so do this before closing the window.
3. **Install.** On that PC, run these in your own PowerShell window (a VS Code terminal works). Replace `<your-agent-manager-delux-url>` with your site's address, which `deploy.ps1` prints at the end:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.agent-manager" | Out-Null
   Invoke-WebRequest "<your-agent-manager-delux-url>/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
   node "$HOME\.agent-manager\agentctl.js" install --url "<your-agent-manager-delux-url>"
   node "$HOME\.agent-manager\agentctl.js" doctor
   ```

   - The install finds the key in your saved user settings on its own, so the key never goes on the command line.
   - It checks the key with Agent Manager Delux before changing anything.
   - It then backs up `~/.claude/settings.json` and prints the backup path.
4. **Check.** `doctor` should show `Hooks: installed` and `Connection: OK`. Open a new Claude Code session: it appears on the Agents tab within a few seconds, under the PC's host name in lower case.

Needs Node.js 18 or newer (`node --version`).

Each PC gets its own key, for three reasons:
- **Labelling:** each machine's reports are tagged with its key's name.
- **Revoking:** you can cut off one PC (a lost laptop, say) on the Keys tab without touching the others.
- **Checking in:** the Keys tab shows when each key was last used, so you can see which PCs are still reporting.

## Good to know

- **Sessions already open** start reporting once Claude Code reloads its settings. A new session always works.
- **Optional activity summaries:** to have agents post a one-line summary when they start a task, add the "Agent Manager Delux" snippet from the instructions page (`/instructions.md`, Claude Code section) to `~/.claude/CLAUDE.md`.
- **Check a PC later:** `node "$HOME\.agent-manager\agentctl.js" doctor` shows the config, the hooks, the heartbeat, open sessions and recent errors.
- **Undo:** `node "$HOME\.agent-manager\agentctl.js" uninstall` removes the hooks.
- **Other kinds of agent:** OpenClaw and services don't use this. They report over HTTP: see the instructions page.
