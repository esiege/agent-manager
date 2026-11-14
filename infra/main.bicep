// Agent Manager Delux in Azure: a Static Web App (React UI + managed Functions API),
// Cosmos DB serverless for storage, a storage account for blocker screenshots and videos,
// and Application Insights for the app's own telemetry.
// Deploy with scripts/deploy.ps1, which also builds and uploads the app.

@description('Name prefix for every resource.')
param name string = 'agentmanager'

@description('Region for Cosmos DB and monitoring.')
param location string = resourceGroup().location

@description('Region for the Static Web App (it is offered in fewer regions).')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param webLocation string = 'westus2'

@description('Sign-in names allowed to use the UI and read API, comma separated (GitHub usernames, since sign-in is through GitHub).')
param ownerLogins string

@description('Static Web Apps plan. Free covers phase 1 (HTTP API only).')
@allowed(['Free', 'Standard'])
param webSku string = 'Free'

var suffix = uniqueString(resourceGroup().id)
var retentionSeconds = 30 * 24 * 3600

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${name}-db-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'agentmanager'
  properties: { resource: { id: 'agentmanager' } }
}

var containers = [
  { id: 'agents', partitionKey: '/id', ttl: null }
  { id: 'keys', partitionKey: '/id', ttl: null }
  { id: 'alerts', partitionKey: '/id', ttl: null }
  { id: 'events', partitionKey: '/agentId', ttl: retentionSeconds }
  { id: 'logs', partitionKey: '/source', ttl: retentionSeconds }
  { id: 'messages', partitionKey: '/machine', ttl: 86400 }
  { id: 'perfSessions', partitionKey: '/id', ttl: 365 * 24 * 3600 }
  { id: 'perfSamples', partitionKey: '/sessionId', ttl: retentionSeconds }
  { id: 'blockers', partitionKey: '/id', ttl: 90 * 24 * 3600 }
]

resource containerResources 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [
  for c in containers: {
    parent: database
    name: c.id
    properties: {
      resource: union(
        { id: c.id, partitionKey: { paths: [c.partitionKey], kind: 'Hash' } },
        c.ttl == null ? {} : { defaultTtl: c.ttl }
      )
    }
  }
]

// Blocker screenshots and videos: too big for Cosmos documents. Private; the API reads them
// with the account key and serves them to the signed-in owner.
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('${replace(name, '-', '')}${suffix}', 24)
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'blocker-media'
  properties: { publicAccess: 'None' }
}

// Blockers are kept 90 days after their last change (the Cosmos TTL); their files go too.
resource mediaLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-old-blocker-media'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['blocker-media/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 90 } } }
          }
        }
      ]
    }
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-insights-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${name}-${suffix}'
  location: webLocation
  sku: { name: webSku, tier: webSku }
  properties: {}
}

resource siteSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_KEY: cosmos.listKeys().primaryMasterKey
    COSMOS_DATABASE: 'agentmanager'
    BLOB_ACCOUNT: storage.name
    BLOB_KEY: storage.listKeys().keys[0].value
    BLOB_CONTAINER: mediaContainer.name
    OWNER_LOGINS: ownerLogins
    PUBLIC_URL: 'https://${site.properties.defaultHostname}'
    APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
  }
}

output siteName string = site.name
output siteUrl string = 'https://${site.properties.defaultHostname}'
output cosmosAccount string = cosmos.name
output storageAccount string = storage.name
