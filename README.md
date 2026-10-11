# Agent Manager

One place to see every agent you run: Claude Code sessions on each of your PCs, OpenClaw personas, and services such as Game Master Assistant. Agents report what they're doing to a small API in Azure, and a React UI shows who's working, who's waiting on you, who stopped, and their logs. Any agent sets itself up by reading the instructions page.

The plan is in [Docs/Spec-v2.md](Docs/Spec-v2.md). This code is phase 1.

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

- **What it reports:** session start and end, prompts, tool activity (the tool name and its short description only, never commands, file contents or prompts), waiting on you, sub-agents, and API failures.
- **Closed windows:** a heartbeat process, started by the hooks, checks every 60 s which Claude Code processes are still alive.

Run `node "$HOME/.agent-manager/agentctl.js" doctor` to check a PC.
