# Agent Manager

A self-hosted dashboard for the AI agents you run. See which Claude Code sessions on your PCs are working, which are waiting on you, and what each one finished and wants you to check.

## Why

If you run agents in several windows on more than one machine, you lose track of them. You find out a session was waiting for approval an hour after it asked, or you can't remember which one fixed what. Agent Manager gives you one page that's never more than a few seconds behind.

## What you get

- **Live status.** Every session on every PC: working, waiting on you, idle, or stopped. Closed windows are noticed within a minute.
- **What each one is doing.** The story it's working on, its current step, and your latest prompt to it.
- **Finished work, with what to check.** When an agent finishes, it reports what it did in a few bullets, a list of things for you to check, and a link to the commit.
- **Reporting.** Work sorted by type (features, bug fixes, docs and so on), with what the tokens would have cost at API list prices.
- **Phone alerts** through [ntfy](https://ntfy.sh) when an agent finishes, waits on you, fails, or is cut off mid-request. You can limit them to certain projects.
- **Messages to an idle session** from its page. Off by default, and turned on separately on each PC.
- **Other agents and services** can report through the same API. Any agent sets itself up by reading the instructions page the site serves.
- **Performance data from games and apps:** frame times and memory per machine, sent with a separate key that can do nothing else.

## How it works

Agent Manager is two parts:

1. **The site:** a React UI and a small API on Azure Static Web Apps, with Cosmos DB (serverless) for storage. One script deploys it to your own Azure account, and on the Free plan it costs close to nothing. Only the GitHub logins you list can sign in.
2. **The reporter** (`agentctl`): one Node file on each PC, with no dependencies. Claude Code runs it from hooks in your user-level settings, so every session on that PC reports without you doing anything per session or per project. Each PC has its own key, which you can revoke on its own.

## What leaves your PC

The reporter sends:
- **Session events:** start and end, waiting on you, sub-agents, API failures, and token counts.
- **Tool activity:** the tool's name and its short description only. It never sends commands, their output, or file contents.
- **Your prompts,** up to 2,000 characters. Pasted text is replaced with `[pasted text]`, and the server masks anything that looks like a secret. To keep prompts on the PC, set `"prompts": false` in `~/.agent-manager/config.json`.
- **Git details:** the project's name, the branch, and a link to the commit, built from the repo's remote.

Everything goes to your own deployment and nowhere else.

The design is in [Docs/Spec-v2.md](Docs/Spec-v2.md).

## Layout

| Folder | What it is |
| --- | --- |
| `shared/` | The data contract (types, validation, state rules, secret masking) used by everything else. |
| `api/` | Azure Functions (Node, v4 model), bundled into one file. Ingest for agents (machine keys) and reads for the UI (owner sign-in). |
| `web/` | React + Mantine UI. `public/instructions.md` is the page agents read; `public/staticwebapp.config.json` sets routes and sign-in. |
| `reporter/` | `agentctl`, the Claude Code reporter: one Node file that the hooks run. Built into `web/public/agentctl.js` so agents can download it. |
| `infra/` | `main.bicep`: Static Web App, Cosmos DB serverless, Application Insights. |
| `scripts/` | `deploy.ps1`: creates or updates the Azure resources, builds, and uploads. |

## Run it locally

```powershell
npm install
Copy-Item api/local.settings.example.json api/local.settings.json   # then set DEV_OWNER to any name
npm run build -w reporter            # puts agentctl.js in web/public
npm run dev:api                      # http://localhost:7071 (needs Azure Functions Core Tools 4)
npm run dev:web                      # http://localhost:5173, proxies /api to the Functions host
```

Locally, data is kept in `api/.local-store.json` and `DEV_OWNER` stands in for a signed-in owner (ignored in Azure). Tests: `npm test`. Types: `npm run typecheck`.

## Deploy to Azure

```powershell
az login
./scripts/deploy.ps1 -OwnerLogins <your-github-username>
```

It creates the resource group `agent-manager` with a Static Web App (Free plan), a serverless Cosmos DB account and Application Insights, then builds and uploads the app. Sign-in is through GitHub, and only the GitHub usernames in `-OwnerLogins` can see anything; everyone else gets "isn't the owner account". Run it again to ship changes (`-SkipInfra` skips the Bicep step).

## Connect a PC

Once per PC, and you run it yourself: Claude Code in auto mode won't let an agent change Claude Code's own settings. The full steps are in [Docs/Claude-Code-Setup.md](Docs/Claude-Code-Setup.md). In short:

1. In Agent Manager, open **Settings** and make a machine key named after the PC. Run the PowerShell line it shows, which saves the key as `AGENT_MANAGER_KEY`.
2. In your own PowerShell window on that PC, download `agentctl` from `<your site>/agentctl.js` into `~/.agent-manager`, then run `node "$HOME\.agent-manager\agentctl.js" install --url <your site>`, then `doctor`.

`install` adds hooks to `~/.claude/settings.json` (backed up first). From then on every session reports in the background:

- **What it reports:** session start and end, prompts, tool activity, waiting on you, sub-agents, and API failures. For the details, see [What leaves your PC](#what-leaves-your-pc).
- **Closed windows:** a heartbeat process, started by the hooks, checks every 60 s which Claude Code processes are still alive.

Run `node "$HOME/.agent-manager/agentctl.js" doctor` to check a PC.
