<#
.SYNOPSIS
  Copies Agent Manager Delux's data between an install on this PC and one in the cloud.

.DESCRIPTION
  Reads the cloud install's Cosmos DB and Blob Storage details from Azure (you must be signed in with
  az login), builds the API's move-data tool, and runs it.

  ToCloud: copies api/.local-store.json and api/.local-media into the cloud. Safe to run again.
  ToLocal: copies the cloud's data into api/.local-store.json and api/.local-media. An existing local
           file is kept as api/.local-store.json.bak. It also saves where the cloud install is in
           ~/.agent-manager/cloud-install.json, so it can be found again later.

  Neither direction deletes anything from where the data came from.

.EXAMPLE
  ./scripts/move-data.ps1 -Direction ToCloud
.EXAMPLE
  ./scripts/move-data.ps1 -Direction ToLocal -ResourceGroup agent-manager
#>
param(
  [Parameter(Mandatory)][ValidateSet('ToCloud', 'ToLocal')][string]$Direction,
  [string]$ResourceGroup = 'agent-manager'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Az([string]$What, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & az @Arguments 2>$null } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0 -or -not $out) { throw "Couldn't read $What from Azure. Is az signed in, and does the resource group '$ResourceGroup' exist?" }
  return ($out | Out-String).Trim()
}

Write-Host "==> Reading the cloud install in $ResourceGroup" -ForegroundColor Cyan
$cosmos = Invoke-Az 'the Cosmos DB account' @('cosmosdb', 'list', '-g', $ResourceGroup, '--query', '[0].name', '-o', 'tsv')
$env:COSMOS_ENDPOINT = Invoke-Az 'the Cosmos DB address' @('cosmosdb', 'show', '-n', $cosmos, '-g', $ResourceGroup, '--query', 'documentEndpoint', '-o', 'tsv')
$env:COSMOS_KEY = Invoke-Az 'the Cosmos DB key' @('cosmosdb', 'keys', 'list', '-n', $cosmos, '-g', $ResourceGroup, '--query', 'primaryMasterKey', '-o', 'tsv')
$env:COSMOS_DATABASE = 'agentmanager'
$storage = Invoke-Az 'the storage account' @('storage', 'account', 'list', '-g', $ResourceGroup, '--query', '[0].name', '-o', 'tsv')
$env:BLOB_ACCOUNT = $storage
$env:BLOB_KEY = Invoke-Az 'the storage key' @('storage', 'account', 'keys', 'list', '-n', $storage, '-g', $ResourceGroup, '--query', '[0].value', '-o', 'tsv')
$env:BLOB_CONTAINER = 'blocker-media'

Write-Host '==> Building the move-data tool' -ForegroundColor Cyan
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
npm run build -w api 2>&1 | Out-Null
$ErrorActionPreference = $previous
if ($LASTEXITCODE -ne 0) { throw 'Building the API failed. Run "npm run build -w api" to see why.' }

try {
  $tool = if ($Direction -eq 'ToCloud') { 'to-cloud' } else { 'to-local' }
  node api/dist/move-data.js $tool | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Moving the data failed (see above).' }
} finally {
  Remove-Item Env:COSMOS_KEY, Env:BLOB_KEY -ErrorAction SilentlyContinue
}

if ($Direction -eq 'ToLocal') {
  $site = Invoke-Az 'the Static Web App' @('staticwebapp', 'list', '-g', $ResourceGroup, '--query', '[0].defaultHostname', '-o', 'tsv')
  $subscription = Invoke-Az 'the subscription' @('account', 'show', '--query', '{id:id,name:name}', '-o', 'json') | ConvertFrom-Json
  $dir = Join-Path $HOME '.agent-manager'
  New-Item -ItemType Directory -Force $dir | Out-Null
  [ordered]@{
    resourceGroup    = $ResourceGroup
    subscriptionId   = $subscription.id
    subscriptionName = $subscription.name
    siteUrl          = "https://$site"
    movedToLocalAt   = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $dir 'cloud-install.json')
  Write-Host "Saved where the cloud install is in $(Join-Path $dir 'cloud-install.json')" -ForegroundColor Green
}
