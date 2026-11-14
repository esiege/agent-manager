# Set up Agent Manager Delux

You are an agent, probably Claude Code, and the user wants their own copy of Agent Manager Delux: a dashboard for the AI agents they run. Your job is to get it running and hand them the address.

Work in the folder you were started in. Talk the user through each step in a sentence or two. They may never have used Azure, or a terminal much.

## Which kind

There are two ways to run it. The user's message usually says which one. If it doesn't, explain both and ask:

| | In the cloud (Azure) | On this PC |
| --- | --- | --- |
| Reachable from | Every PC, and the user's phone | This PC only |
| Sign-in | GitHub, limited to the usernames given | None. It's only reachable from this PC. |
| Has to be running | Nothing: it's always up | Two terminal windows, left open |
| Needs | A free Azure account | Nothing extra |
| Cost | Cents a month | Free |

The cloud is the better choice if they run agents on more than one PC, or want to check on them from their phone. "On this PC" is good for trying it out, or if they only use one machine. They can switch later and take their data with them: see [Docs/Move-To-Cloud.md](Docs/Move-To-Cloud.md) and [Docs/Move-To-Local.md](Docs/Move-To-Local.md).

Then follow [In the cloud](#in-the-cloud) or [On this PC](#on-this-pc).

## Both: check the tools and get the code

Run each check, and tell the user what's missing and how to install it before you go on:

| Tool | Check | Needed for |
| --- | --- | --- |
| Git | `git --version` | Both |
| Node.js 20 or newer | `node --version` | Both |
| Azure CLI | `az version` | The cloud |
| PowerShell | `pwsh --version`, or Windows PowerShell on Windows | The cloud: it runs `scripts/deploy.ps1` |
| Azure Functions Core Tools 4 | `func --version` | This PC: it runs the API |

How to install them:

- **Windows:** `winget install Git.Git OpenJS.NodeJS.LTS`. Add `Microsoft.AzureCLI` for the cloud, or `Microsoft.Azure.FunctionsCoreTools` for this PC.
- **macOS:** `brew install git node`. Add `azure-cli powershell` for the cloud. For this PC, run `brew tap azure/functions`, then `brew install azure-functions-core-tools@4`.

The tools may only show up in a new terminal.

Then get the code. If the folder is empty, clone into it. If it already has this repo in it, run `git pull` instead.

```sh
git clone https://github.com/esiege/agent-manager-delux.git .
npm install
npm run build
npm test
```

If the tests fail, stop and show the user the output.

## In the cloud

It's hosted in the user's own Azure account, and only the GitHub usernames they give can sign in.

### When to stop and ask

Don't guess at these. Ask, and wait for the answer:

- **Signing in to Azure.** `az login` opens a browser, so the user has to do it. Ask them to type `! az login` in Claude Code, or to run `az login` in their own terminal.
- **Which Azure subscription.** If `az account list` shows more than one, show them the list and ask which one to use.
- **Who can sign in.** Ask for their GitHub username. Only the usernames passed to the deploy script can see the dashboard. Several are allowed, separated by commas.
- **Anything that costs money beyond what's described below,** or any error you'd fix by changing settings in their Azure account.

### 1. Sign in to Azure

Run `az account show`. If it says you aren't signed in, ask the user to sign in. Then confirm the subscription with them.

If they have no Azure account, send them to <https://azure.microsoft.com/free>. A free account is enough.

### 2. Deploy

Tell the user what will be created, in the resource group `agent-manager`:

- A **Static Web App** on the Free plan: the site and its API.
- A **Cosmos DB** account, serverless: where the data is kept. It's billed per request, which for one person comes to cents a month.
- A **storage account**, and **Application Insights** for logs. Both are also pay-as-you-go and tiny at this scale.

Once they agree, run this from the repo folder, with their GitHub username:

```powershell
./scripts/deploy.ps1 -OwnerLogins <github-username>
```

It takes a few minutes, and it's safe to run again if it stops partway. It ends by printing the site's address.

If it fails with a message about a resource provider not being registered, run `az provider register --namespace <the namespace it names> --wait`, then run the script again. You can do this without asking: it only turns the service on for the subscription.

### 3. Check it's live

```sh
curl -s -o /dev/null -w "%{http_code}\n" <site address>/instructions.md
```

It should print `200`. Then ask the user to open the site address and sign in with GitHub. If it says the account "isn't the owner account", they signed in with a different username from the one you deployed with. Run the deploy again with the right one.

To ship a newer version later: `git pull`, then `./scripts/deploy.ps1 -SkipInfra` in this folder.

Now [hand over](#hand-over).

## On this PC

It runs as two local servers, `http://localhost:5173` for the site and `http://localhost:7071` for the API, with its data in `api/.local-store.json`. There's no sign-in, so it must stay reachable from this PC only.

### 1. Configure it

Copy `api/local.settings.example.json` to `api/local.settings.json`, and set `DEV_OWNER` to the user's name. That's who the site treats as signed in. Leave the Cosmos settings empty, so the data is kept in the local file.

### 2. Start it

Both servers have to keep running after you finish, so they can't be your own background processes. Ask the user to open two terminals in this folder and run one command in each:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

**If a firewall asks whether to allow `node` or `func` on the network, tell them to say no.** Anyone who can reach these ports can see and change everything.

Tell them that next time, they start it again with the same two commands, and that agents can't report while it's stopped.

### 3. Check it's running

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/instructions.md
```

It should print `200`. Ask the user to open `http://localhost:5173`.

To get a newer version later: stop both servers, then run `git pull`, `npm install`, `npm run build`, and start them again.

## Hand over

Tell the user:

1. The site's address, and that it's worth bookmarking.
2. To connect a PC that runs agents, they send an agent on that PC this sentence. It's also on the site's **Instructions** tab, ready to copy:

   > Read `<site address>/instructions.md` and set yourself up to report to Agent Manager Delux.

   On this PC only, that's the one PC that can report.
