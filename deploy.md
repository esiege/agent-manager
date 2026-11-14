# Deploy Agent Manager Delux

You are an agent, probably Claude Code, and the user wants their own copy of Agent Manager Delux: a dashboard for the AI agents they run. It's hosted in their own Azure account, and only they can sign in. Your job is to get it live and hand them the address.

Work in the folder you were started in. Talk the user through each step in a sentence or two. They may never have used Azure.

## When to stop and ask

Don't guess at these. Ask, and wait for the answer:

- **Signing in to Azure.** `az login` opens a browser, so the user has to do it. Ask them to type `! az login` in Claude Code, or to run `az login` in their own terminal.
- **Which Azure subscription.** If `az account list` shows more than one, show them the list and ask which one to use.
- **Who can sign in.** Ask for their GitHub username. Only the usernames passed to the deploy script can see the dashboard. Several are allowed, separated by commas.
- **Anything that costs money beyond what's described below,** or any error you'd fix by changing settings in their Azure account.

## 1. Check the tools

Run each check, and tell the user what's missing and how to install it before you go on:

| Tool | Check | Needed for |
| --- | --- | --- |
| Git | `git --version` | Getting the code |
| Node.js 20 or newer | `node --version` | Building |
| Azure CLI | `az version` | Creating the Azure resources |
| PowerShell | `pwsh --version`, or Windows PowerShell on Windows | Running `scripts/deploy.ps1` |

To install them, Windows users can use `winget install Git.Git OpenJS.NodeJS.LTS Microsoft.AzureCLI`, and macOS users can use `brew install git node azure-cli powershell`. A new terminal may be needed before the tools show up.

## 2. Get the code and build it

If the folder is empty, clone into it. If it already has this repo in it, run `git pull` instead.

```sh
git clone https://github.com/esiege/agent-manager-delux.git .
npm install
npm run build
npm test
```

If the tests fail, stop and show the user the output.

## 3. Sign in to Azure

Run `az account show`. If it says you aren't signed in, ask the user to sign in (see [When to stop and ask](#when-to-stop-and-ask)). Then confirm the subscription with them.

If they have no Azure account, send them to <https://azure.microsoft.com/free>. A free account is enough.

## 4. Deploy

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

## 5. Check it's live

```sh
curl -s -o /dev/null -w "%{http_code}\n" <site address>/instructions.md
```

It should print `200`. Then ask the user to open the site address and sign in with GitHub. If it says the account "isn't the owner account", they signed in with a different username from the one you deployed with. Run the deploy again with the right one.

## 6. Hand over

Tell the user:

1. The site's address, and that it's worth bookmarking.
2. To connect each PC that runs agents, they send an agent on that PC this sentence. It's also on the site's **Instructions** tab, ready to copy:

   > Read `<site address>/instructions.md` and set yourself up to report to Agent Manager Delux.

3. To ship a newer version later, run `git pull`, then `./scripts/deploy.ps1 -SkipInfra` in this folder.
