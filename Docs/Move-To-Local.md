# Move Agent Manager Delux from the cloud to this PC

You are an agent, probably Claude Code, and the user runs Agent Manager Delux in their Azure account. They want to run it on this PC instead. Your job is to set up the local copy, bring their data across, switch this PC over, and then **ask the user what to do with the Azure resources**: delete them, or keep them and save where they are for later.

Talk the user through each step in a sentence or two.

## Before you start, make sure they know

Running on this PC means:

- **Only this PC can reach it.** Agents on other PCs, their phone, and games running elsewhere can't report to it or read it.
- **There's no sign-in,** so it must not be opened up to the network.
- **It only works while two terminal windows are open** with the servers running.
- **Everything is kept in one file.** A long history makes the file big (a busy install can reach 70 MB or more), and the local server rewrites the file on each report, so it can be slower than the cloud.

If that's not what they want, stop here.

## What moves, and what doesn't

- **Moves:** agents and their history, reporting data, finished work, blockers with their screenshots and videos, performance data, alert subscriptions, and keys. The key this PC uses keeps working.
- **Doesn't move:** messages to agents (they're only kept a day anyway).
- **Nothing in the cloud is touched by the copy.** The cloud install keeps running until step 6.

## When to stop and ask

- **Signing in to Azure.** `az login` opens a browser, so the user has to do it. Ask them to type `! az login` in Claude Code, or to run `az login` in their own terminal.
- **Which resource group** holds the install, if it isn't `agent-manager`. `az group list -o table` lists them.
- **Deleting the Azure resources (step 6).** Never do this without a clear yes in answer to that exact question.

## 1. Get the code

If this PC already has a clone of the repo (the one used to deploy, for example), work there and run `git pull`. Otherwise make a folder and clone into it:

```sh
git clone https://github.com/esiege/agent-manager-delux.git .
```

Then check the tools and set up the local copy, following [deploy.md](../deploy.md):

- [Both: check the tools and get the code](../deploy.md#both-check-the-tools-and-get-the-code). It needs the **Azure CLI** and **PowerShell** too, to read the data out of the cloud.
- [On this PC, step 1: configure it](../deploy.md#1-configure-it).

Don't start the servers yet.

## 2. Copy the data

Check `az account show` is signed in to the subscription with the install. Then:

```powershell
./scripts/move-data.ps1 -Direction ToLocal
```

Pass `-ResourceGroup <name>` if it isn't `agent-manager`. It writes `api/.local-store.json` and `api/.local-media`, and keeps any local data that was already there as `api/.local-store.json.bak`. It also saves where the cloud install is in `~/.agent-manager/cloud-install.json`.

## 3. Start it

Follow [On this PC, steps 2 and 3](../deploy.md#2-start-it): the user starts the two servers in their own terminals, and you check `http://localhost:5173` answers. Ask them to open it and check their agents and history are there.

## 4. Switch this PC over

Point this PC's reporter at the local copy, keeping the same key:

```sh
node ~/.agent-manager/agentctl.js install --url http://localhost:5173
node ~/.agent-manager/agentctl.js test
```

If `AGENT_MANAGER_URL` is set in the environment, it overrides the config, so tell the user to change it or remove it.

## 5. Other PCs

Reports from other PCs can't reach this one. Tell the user that on each other PC, an agent (or they) should run:

```sh
node ~/.agent-manager/agentctl.js uninstall
```

This removes the hooks, so Claude Code there stops trying to report. If the user keeps the cloud install (next step), those PCs can stay pointed at it instead, but nothing they report there shows up locally.

## 6. Ask: delete the cloud install, or keep it?

Ask the user this, plainly, and wait for the answer:

> Your data is now on this PC. The Azure resources are still there. Do you want to **delete them**, or **keep them** so you can move back later?

Explain the difference:

- **Keep:** nothing to do. Where it is has been saved in `~/.agent-manager/cloud-install.json`, and [Move-To-Cloud.md](Move-To-Cloud.md) offers to use it again. While it's unused, it costs very little: the Static Web App is on the Free plan, Cosmos DB serverless and the storage account charge mainly for the data they hold (cents a month at this size), and Application Insights charges only for logs it receives. Old data is still deleted on its usual schedule, so in a year the cloud copy is mostly empty.
- **Delete:** removes the site, the database and everything in it, permanently. The local copy is then the only copy.

**If they choose delete,** say back what will be deleted and ask once more. Show them the list first:

```sh
az resource list -g <resource group> -o table
```

Only when they say yes to that:

```sh
az group delete -n <resource group> --yes
rm ~/.agent-manager/cloud-install.json
```

Deleting takes a few minutes. Tell them that GitHub sign-in to the old address stops working, and that the Static Web App's name won't come back if they deploy again later: they'd get a new address.

**If they choose keep,** show them what was saved in `~/.agent-manager/cloud-install.json`.

## 7. Hand over

Tell the user:

1. The address: `http://localhost:5173`.
2. Next time, they start it with `npm run dev:api` and `npm run dev:web` in two terminals. Agents can't report while it's stopped.
3. What happened to the cloud install.
4. To move back later, they send an agent this:

   > Read https://raw.githubusercontent.com/esiege/agent-manager-delux/main/Docs/Move-To-Cloud.md and move my Agent Manager Delux from this PC to the cloud.
