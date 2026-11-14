<#
.SYNOPSIS
  Creates or updates Agent Manager Delux in Azure, then builds and uploads the app.

.DESCRIPTION
  1. Creates the resource group and deploys infra/main.bicep (Static Web App, Cosmos DB serverless,
     Application Insights). Safe to run again: it updates what's there.
  2. Builds the reporter, API and web UI.
  3. Uploads the UI and the API to the Static Web App with the SWA CLI.

.EXAMPLE
  ./scripts/deploy.ps1 -OwnerLogins <your-github-username>
#>
param(
  [string]$ResourceGroup = 'agent-manager',
  [string]$Location = 'westus2',
  [string]$WebLocation = 'westus2',
  [string]$Name = 'agentmanager',
  # GitHub usernames allowed to sign in, comma separated. Required unless -SkipInfra.
  [string]$OwnerLogins = '',
  [switch]$SkipInfra
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Native([string]$What, [scriptblock]$Command) {
  Write-Host "==> $What" -ForegroundColor Cyan
  # Windows PowerShell 5.1 turns a native tool's stderr (npm and az progress) into errors,
  # which 'Stop' would make fatal. Judge native tools by their exit code instead.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Command 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.ToString() } else { $_ } }
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
  return $out
}

if (-not $SkipInfra -and -not $OwnerLogins) {
  throw 'Pass -OwnerLogins with the GitHub username(s) allowed to sign in, for example -OwnerLogins your-github-username'
}

if (-not $SkipInfra) {
  Invoke-Native "Creating resource group $ResourceGroup" { az group create --name $ResourceGroup --location $Location --output none } | Out-Null
  $outputs = Invoke-Native 'Deploying infra/main.bicep' {
    az deployment group create --resource-group $ResourceGroup --template-file infra/main.bicep `
      --parameters name=$Name location=$Location webLocation=$WebLocation ownerLogins=$OwnerLogins `
      --query properties.outputs --output json
  } | ConvertFrom-Json
  $siteName = $outputs.siteName.value
  $siteUrl = $outputs.siteUrl.value
} else {
  $siteName = Invoke-Native 'Finding the Static Web App' {
    az staticwebapp list --resource-group $ResourceGroup --query "[0].name" -o tsv
  }
  $siteUrl = 'https://' + (Invoke-Native 'Reading its address' {
    az staticwebapp show --name $siteName --resource-group $ResourceGroup --query defaultHostname -o tsv
  })
}

Invoke-Native 'Building reporter, API and web UI' { npm run build } | Out-Host

# The API is bundled into one file. Deploy it with a package.json that has no dependencies,
# so the platform has nothing to install (the workspace package isn't on npm).
$staging = Join-Path $root '.deploy/api'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force (Join-Path $staging 'dist') | Out-Null
Copy-Item api/host.json $staging
Copy-Item api/dist/index.js, api/dist/index.js.map (Join-Path $staging 'dist')
@{ name = 'agent-manager-delux-api'; version = '1.0.0'; private = $true; main = 'dist/index.js' } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $staging 'package.json')

$token = Invoke-Native 'Reading the deployment token' {
  az staticwebapp secrets list --name $siteName --resource-group $ResourceGroup --query properties.apiKey -o tsv
}
Invoke-Native 'Uploading to Static Web Apps' {
  npx --yes @azure/static-web-apps-cli@2 deploy web/dist --api-location $staging --api-language node --api-version 20 `
    --deployment-token $token --env production
} | Out-Host

Write-Host ''
Write-Host "Agent Manager Delux is at $siteUrl" -ForegroundColor Green
Write-Host "Sign in with GitHub."
Write-Host 'Next: tell an agent:'
Write-Host "  Read $siteUrl/instructions.md and set yourself up to report to Agent Manager Delux."
