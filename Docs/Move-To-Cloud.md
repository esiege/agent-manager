# Move Agent Manager Delux from this PC to the cloud

You are an agent, probably Claude Code, and the user runs Agent Manager Delux on this PC (two local servers, with the data in `api/.local-store.json`). They want it in the cloud instead, so every PC and their phone can reach it. Your job is to set up the cloud copy, bring their data across, and switch this PC over.

Work in the repo folder of the local copy. Talk the user through each step in a sentence or two.

## What moves, and what doesn't

- **Moves:** agents and their history, reporting data, finished work, blockers with their screenshots and videos, performance data, alert subscriptions, and **keys**. Keys move as hashes, so the key this PC already uses keeps working, and so do game keys.
- **Doesn't move:** messages to agents (they're only kept a day anyway).
- **Nothing is deleted.** The local file stays where it is, as a backup.

## When to stop and ask

- **Signing in to Azure.** `az login` opens a browser, so the user has to do it. Ask them to type `! az login` in Claude Code, or to run `az login` in their own terminal.
- **Which Azure subscription,** if there's more than one.
- **Their GitHub username,** for who can sign in.
- **Before running the deploy,** say what it creates and what it costs (see [deploy.md](../deploy.md#2-deploy)).

## 1. Update the code

```sh
git pull
npm install
npm run build
```

## 2. Get a cloud install

**Check for one from before:** if `~/.agent-manager/cloud-install.json` exists, the user moved from the cloud to this PC earlier and kept the Azure resources. Show them what it says (the resource group, subscription and address) and ask whether to use it again.

- **If they say yes:** run `az account set --subscription <subscriptionId from the file>`. Then run `./scripts/deploy.ps1 -ResourceGroup <resourceGroup> -OwnerLogins <github-username>`, which updates the resources and ships the latest code. The data already in it stays, and what you copy next is added on top. Then delete `~/.agent-manager/cloud-install.json`: the install is in use again.
- **Otherwise:** follow [deploy.md](../deploy.md#in-the-cloud): check the Azure CLI and PowerShell, sign in, deploy, and check it's live.

Note the site address it prints.

## 3. Stop the local servers

Ask the user to stop `npm run dev:api` and `npm run dev:web` (Ctrl+C in each window). This stops anything being written while you copy. Check they're stopped:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7071/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

Both print `000` when nothing is listening.

## 4. Copy the data

```powershell
./scripts/move-data.ps1 -Direction ToCloud
```

Pass `-ResourceGroup <name>` if the cloud install isn't in `agent-manager`. It prints how many of each kind of item it copied. Anything already past its retention (for example, logs older than 30 days) is left out. It's safe to run again if it stops partway.

## 5. Switch this PC over

This PC's reporter still points at `http://localhost:5173`. Point it at the cloud, keeping the same key:

```sh
node ~/.agent-manager/agentctl.js install --url <site address>
node ~/.agent-manager/agentctl.js test
```

`test` should say the cloud accepted a test report. If `AGENT_MANAGER_URL` is set in the environment, it overrides the config, so tell the user to change it or remove it.

Ask the user to open the site address, sign in with GitHub, and check that their agents and history are there.

## 6. Hand over

Tell the user:

1. The site address.
2. They no longer need the two local servers. `api/.local-store.json` stays as a backup, and they can delete it once they're happy.
3. To connect their other PCs, they send an agent on each one this sentence:

   > Read `<site address>/instructions.md` and set yourself up to report to Agent Manager Delux.

4. If a game sends performance data, its builds need the new address. Its key still works.
