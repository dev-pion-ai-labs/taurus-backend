# AI Deployment Agent — Implementation Roadmap

> Taurus Module 5: From planning automation to deploying it.
> **Decision: Integrate with client tools** — connect to whatever tools clients already use via OAuth/API keys.

---

## Phase 0 — Foundation

**Goal:** Credential vault, audit logging, adapter interface, dry-run capability. No external API calls yet.

### 0.1 Credential Vault

Encrypted storage for OAuth tokens and API keys per organization per provider.

```
OrgIntegration {
  id              String   @id @default(cuid())
  organizationId  String
  provider        IntegrationProvider  // SLACK, GITHUB, ZAPIER, MAKE, N8N_CLOUD, CUSTOM
  label           String?              // "Production Slack", "Main GitHub Org"
  authType        AuthType             // OAUTH2, API_KEY, BEARER_TOKEN
  credentials     Json                 // encrypted (aes-256-gcm)
  scopes          String[]
  status          IntegrationStatus    // CONNECTED, EXPIRED, REVOKED, ERROR
  expiresAt       DateTime?
  lastUsedAt      DateTime?
  metadata        Json?               // provider-specific (workspace ID, org name, etc.)
  createdAt       DateTime
  updatedAt       DateTime
}
```

```typescript
// src/deployment/credential-vault.service.ts
class CredentialVaultService {
  encrypt(data: object): string
  decrypt(encrypted: string): object
  store(orgId, provider, authType, credentials, scopes)
  retrieve(orgId, provider): DecryptedCredentials
  revoke(integrationId)
  refreshIfExpired(integrationId)
}
```

**Encryption:** `aes-256-gcm` with dedicated `CREDENTIAL_ENCRYPTION_KEY` env var. Never reuse JWT secrets.

### 0.2 Audit Log

Every action the agent takes on an external system gets logged.

```
DeploymentAuditLog {
  id              String   @id @default(cuid())
  organizationId  String
  planId          String?
  integrationId   String
  action          String              // "create_channel", "create_zap", etc.
  provider        IntegrationProvider
  request         Json                // sanitized — no secrets
  response        Json?
  status          AuditStatus         // PENDING, SUCCESS, FAILED, ROLLED_BACK
  rollbackData    Json?               // data needed to undo this action
  executedBy      String              // userId who approved
  executedAt      DateTime
  rolledBackAt    DateTime?
}
```

### 0.3 Adapter Interface

```typescript
// src/deployment/adapters/base.adapter.ts
interface DeploymentAdapter {
  provider: IntegrationProvider;
  testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult>;
  listResources(type: string): Promise<Resource[]>;
  getResource(type: string, id: string): Promise<Resource>;
  dryRun(action: DeploymentAction): Promise<DryRunResult>;
  execute(action: DeploymentAction): Promise<ExecutionResult>;
  rollback(auditLogId: string): Promise<RollbackResult>;
}
```

### 0.4 OAuth Callback Infrastructure

```
GET  /integrations/connect/:provider     → redirect to provider's OAuth consent screen
GET  /integrations/callback/:provider    → handle callback, exchange code for tokens, encrypt & store
POST /integrations/connect-api-key       → manually enter API key (for providers without OAuth)
GET  /integrations                       → list org's connected integrations
POST /integrations/:id/test              → test connection
DELETE /integrations/:id                 → revoke and delete tokens
```

### 0.5 Token Refresh Job

Background job (BullMQ repeatable, daily):
- Find integrations where `expiresAt` is within 7 days
- Attempt token refresh via provider's refresh endpoint
- On failure: mark status → EXPIRED, notify org admins via email

### 0.6 Settings UI (Frontend)

New "Integrations" section in org settings:
- Grid of supported providers with Connect / Connected status
- Connect button → launches OAuth popup or shows API key form
- Connection status indicator (green/yellow/red)
- Test Connection button
- Disconnect button (with confirmation)

### Phase 0 Deliverables
- [ ] Prisma migration: `OrgIntegration` + `DeploymentAuditLog`
- [ ] CredentialVaultService with encrypt/decrypt
- [ ] Base adapter interface + shared types
- [ ] OAuth callback controller + routes
- [ ] Token refresh background job
- [ ] Integration CRUD endpoints
- [ ] Frontend integrations settings page
- [ ] Unit tests for encryption + adapter contract

### Go / No-Go
- Can store and retrieve encrypted credentials without leaking tokens
- OAuth redirect → callback → store flow works end-to-end
- Audit log captures operations with rollback data
- Dry-run returns meaningful preview without side effects

---

## Phase 1 — Slack Integration (First Target)

**Why Slack first:**
- Best API documentation of any SaaS tool
- Simple scope — configuration, not workflow logic
- High visibility — clients see immediate results (new channel, bot posting)
- Fast to validate the full loop: connect → agent plans → dry-run → approve → deploy

### 1.1 OAuth Setup

- Create Slack App at api.slack.com
- Required scopes: `channels:read`, `channels:manage`, `channels:join`, `incoming-webhook`, `chat:write`, `users:read`
- OAuth redirect: `GET /integrations/connect/slack` → Slack consent → `GET /integrations/callback/slack`
- Store: `access_token`, `team.id`, `team.name` in encrypted OrgIntegration

### 1.2 Slack Adapter

```typescript
// src/deployment/adapters/slack.adapter.ts
class SlackAdapter implements DeploymentAdapter {
  testConnection()       → auth.test API → return workspace name + bot info
  listResources("channels") → conversations.list → channel names + IDs
  listResources("users")    → users.list → user names + IDs

  dryRun("create_channel")  → validate name, check if exists, return preview
  dryRun("create_webhook")  → validate channel exists, return preview

  execute("create_channel")  → conversations.create → return channel ID
  execute("set_topic")       → conversations.setTopic
  execute("create_webhook")  → incoming-webhooks API → return webhook URL
  execute("post_message")    → chat.postMessage → send test/welcome message
  execute("invite_users")    → conversations.invite → add users to channel

  rollback("create_channel") → conversations.archive → archive (can't delete)
  rollback("create_webhook") → revoke webhook
}
```

### 1.3 Agent Tools

Add to the Claude agent loop alongside existing implementation tools:

```
slack_list_channels      — List workspace channels (to avoid duplicates)
slack_list_users         — List workspace users (for mentioning/inviting)
slack_create_channel     — Create channel with name + topic + purpose
slack_create_webhook     — Create incoming webhook for a channel
slack_post_message       — Send a message to a channel
slack_invite_to_channel  — Add users to a channel
```

### 1.4 Agent Flow

```
User approves deployment plan (existing flow)
       ↓
Agent reads plan steps + checks org has Slack connected
       ↓
Agent calls slack_list_channels → knows what exists, avoids duplicates
       ↓
Agent decides what Slack resources the plan needs
  e.g., "Create #ops-automation channel, set up webhook, post welcome message"
       ↓
DRY-RUN: Shows user exactly what will happen
  "I will: 1) Create channel #ops-automation  2) Set topic: 'Automated alerts'
   3) Create incoming webhook  4) Post welcome message with setup instructions"
       ↓
User approves
       ↓
Agent executes each step sequentially
  → Each step logged in DeploymentAuditLog with rollback data
       ↓
Agent calls slack_post_message → sends confirmation message in new channel
       ↓
Action status → DEPLOYED
```

### 1.5 Safety
- Channel names validated (lowercase, no spaces, Slack naming rules)
- Check for existing channels before creating (no duplicates)
- Webhook URLs never exposed in frontend or logs
- Max 5 channels per deployment
- Messages sanitized (no injection via user-controlled plan content)

### Phase 1 Deliverables
- [ ] Slack App created and configured
- [ ] SlackAdapter implementing DeploymentAdapter
- [ ] OAuth flow: connect → callback → store
- [ ] 6 agent tools registered in Claude loop
- [ ] Dry-run → approve → execute frontend flow
- [ ] Rollback (archive channels, revoke webhooks)
- [ ] Integration tests with Slack API (sandbox workspace)

### Go / No-Go
- OAuth connects a real Slack workspace
- Agent creates a channel + webhook from a deployment plan
- Dry-run accurately previews without side effects
- Rollback archives created channels
- No tokens in logs or API responses

---

## Phase 2 — GitHub Integration

**Why GitHub second:**
- Most clients have repos
- Actions workflows are YAML — Claude generates these well
- Fine-grained permissions via GitHub Apps
- Complements Slack (webhook from GitHub → notification in Slack)

### 2.1 Auth Model

GitHub App (preferred over OAuth App):
- Create GitHub App in Taurus's GitHub org
- Client installs the App on their org/repos
- Permissions: `actions:write`, `contents:write`, `webhooks:write`, `metadata:read`
- Auth flow: App installation → callback → store installation ID + token

### 2.2 GitHub Adapter

```typescript
class GitHubAdapter implements DeploymentAdapter {
  testConnection()              → GET /app/installations → verify access
  listResources("repos")       → list accessible repos
  listResources("workflows")   → list .github/workflows/*.yml in a repo

  dryRun("create_workflow")    → validate YAML, check if file exists
  dryRun("create_webhook")     → validate repo access, check existing hooks

  execute("create_workflow")   → PUT /repos/:owner/:repo/contents/.github/workflows/:name.yml
  execute("create_webhook")    → POST /repos/:owner/:repo/hooks
  execute("create_secret")     → PUT /repos/:owner/:repo/actions/secrets/:name
  execute("trigger_workflow")  → POST /repos/:owner/:repo/actions/workflows/:id/dispatches

  rollback("create_workflow")  → DELETE file via Contents API
  rollback("create_webhook")   → DELETE /repos/:owner/:repo/hooks/:id
}
```

### 2.3 Agent Tools

```
github_list_repos            — List org's accessible repos
github_list_workflows        — List existing Actions workflows in a repo
github_create_workflow       — Create .github/workflows/*.yml
github_create_webhook        — Set up repo webhook
github_trigger_workflow      — Manually trigger for testing
github_list_secrets          — List secret names (not values) in a repo
```

### Phase 2 Deliverables
- [ ] GitHub App created and published
- [ ] GitHubAdapter implementing DeploymentAdapter
- [ ] App installation flow + callback
- [ ] 6 agent tools
- [ ] YAML workflow generation from plans
- [ ] Test trigger + verify before committing
- [ ] Rollback (delete files, remove webhooks)

### Go / No-Go
- App installs on a test GitHub org
- Agent creates valid Actions YAML that passes GitHub's validation
- Webhooks fire correctly
- Rollback cleanly removes created files

---

## Phase 3 — Workflow Automation (Zapier or Make)

**Decide based on client usage data.** Ask clients which they use.

### Option A: Make.com (Recommended)
- Better API for programmatic scenario creation
- API key auth (simpler than Zapier's partner program)
- Can create scenarios with modules, connections, scheduling

### Option B: Zapier
- Requires Partner API approval (application process, can take weeks)
- More limited API — may not support full zap creation
- More widely used by non-technical clients

### 3.1 Adapter (Make.com example)

```typescript
class MakeAdapter implements DeploymentAdapter {
  testConnection()               → verify API key
  listResources("scenarios")     → list existing scenarios
  listResources("connections")   → list configured connections

  dryRun("create_scenario")     → validate blueprint, return preview
  execute("create_scenario")    → create scenario from blueprint
  execute("activate_scenario")  → turn on scheduling
  execute("create_connection")  → set up a connection (e.g., to Slack, CRM)

  rollback("create_scenario")  → delete scenario
}
```

### 3.2 Agent Tools

```
make_list_scenarios       — List existing scenarios
make_list_connections     — List configured connections
make_list_modules         — List available modules/apps
make_create_scenario      — Create automation scenario
make_activate_scenario    — Activate scenario
make_test_scenario        — Run scenario once for testing
```

### Phase 3 Deliverables
- [ ] Make (or Zapier) adapter
- [ ] Auth flow (API key or OAuth)
- [ ] 6 agent tools
- [ ] Scenario creation from deployment plans
- [ ] Rollback (delete scenarios)

---

## Phase 4 — Multi-Tool Orchestration

**Goal:** Agent composes deployments across multiple connected tools in a single plan.

Example: "Create a GitHub webhook that triggers a Make scenario that posts to a Slack channel."

### 4.1 Deployment Sessions

```
DeploymentSession {
  id              String
  planId          String
  organizationId  String
  status          PREPARING | DRY_RUN | APPROVED | EXECUTING | COMPLETED | FAILED | ROLLED_BACK
  steps           DeploymentStep[]    // ordered, with dependencies
  startedAt       DateTime?
  completedAt     DateTime?
}

DeploymentStep {
  id              String
  sessionId       String
  integrationId   String
  provider        IntegrationProvider
  action          String
  params          Json
  dependsOn       String[]            // step IDs that must complete first
  status          PENDING | DRY_RUN | APPROVED | EXECUTING | COMPLETED | FAILED
  result          Json?
  auditLogId      String?
}
```

### 4.2 Cross-Tool Dependencies

Agent resolves output → input chains:

```
Step 1: slack_create_channel → output: channel_id
Step 2: slack_create_webhook (channel_id) → output: webhook_url
Step 3: make_create_scenario (uses webhook_url as HTTP module target) → output: scenario_webhook_url
Step 4: github_create_webhook (target: scenario_webhook_url) → done

Test: push to GitHub → Make processes → Slack notifies
```

### 4.3 Cascading Rollback

If step 3 fails:
1. Rollback step 3 (if partially created)
2. Rollback step 2 (revoke webhook)
3. Rollback step 1 (archive channel)
4. Steps 4+ never started — skip

### 4.4 Frontend

- Deployment progress view: each step shown with status (pending → executing → done)
- Real-time updates (polling or SSE)
- Per-step approve/reject for cautious users
- One-click rollback button

### Phase 4 Deliverables
- [ ] DeploymentSession + DeploymentStep models
- [ ] Orchestrator service with dependency resolution
- [ ] Cascading rollback engine
- [ ] Multi-tool deployment UI with progress tracking
- [ ] End-to-end integration test (3-tool chain)

### Go / No-Go
- A 3-tool deployment completes successfully
- Failure at any step triggers clean rollback of prior steps
- User sees real-time progress

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Frontend                         │
│  Settings → Connect Tools (OAuth / API key)      │
│  Implementation → Approve → Dry-Run → Deploy    │
│  Dashboard → Deployment progress + history       │
└─────────────────────┬────────────────────────────┘
                      │ REST API
┌─────────────────────▼────────────────────────────┐
│            Deployment Controller                  │
│  POST /deploy/:planId                            │
│  GET  /deploy/sessions/:id                       │
│  POST /deploy/sessions/:id/approve               │
│  POST /deploy/sessions/:id/rollback              │
└─────────────────────┬────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────┐
│         Deployment Orchestrator Service           │
│  Resolve dependencies → dry-run all steps →      │
│  wait for approval → execute sequentially →      │
│  audit each step → rollback on failure           │
└────────┬────────────┬────────────┬───────────────┘
         │            │            │
  ┌──────▼───┐  ┌─────▼────┐  ┌───▼───────┐
  │  Slack   │  │  GitHub  │  │  Make.com  │
  │  Adapter │  │  Adapter │  │  Adapter   │
  └──────┬───┘  └─────┬────┘  └───┬───────┘
         │            │            │
  ┌──────▼───┐  ┌─────▼────┐  ┌───▼───────┐
  │ Slack API│  │GitHub API│  │ Make API  │
  └──────────┘  └──────────┘  └───────────┘

┌──────────────────────────────────────────────────┐
│               Support Layer                       │
│  CredentialVault │ AuditLogger │ RollbackEngine   │
└──────────────────────────────────────────────────┘
```

---

## Security Checklist

- [ ] `CREDENTIAL_ENCRYPTION_KEY` env var (dedicated, not reused)
- [ ] aes-256-gcm encryption for all stored credentials
- [ ] Credentials never in logs, API responses, or error messages
- [ ] All external API calls logged in DeploymentAuditLog (sanitized)
- [ ] Dry-run before every write operation
- [ ] User approval required before execution
- [ ] Rollback data stored for every successful action
- [ ] Rate limiting on deployment operations
- [ ] OAuth tokens scoped to minimum required permissions
- [ ] Token refresh background job
- [ ] Webhook URLs never exposed to frontend
- [ ] Input sanitization on all agent-generated content

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Client revokes OAuth access | Can't manage their tools | Detect on next call, mark REVOKED, prompt re-auth |
| Token expires mid-deployment | Deployment hangs | Pre-check validity, refresh before starting |
| Agent hallucinates API params | Invalid API calls | Validate against known schemas before execution |
| Rate limited by external API | Deploy fails midway | Sequential execution with backoff, resume from last step |
| Credential leak | Security breach | Encrypt at rest, sanitize all logs, never return raw tokens |
| Partial deployment fails | Inconsistent state across tools | Cascading rollback, atomic deployment sessions |
| Slack/GitHub API changes | Adapter breaks | Version-pin SDK, monitor deprecation notices |
| Client has free-tier limits | Can't create resources | Pre-check quotas where API allows, warn user |

---

## Timeline

| Phase | Scope | Depends On |
|-------|-------|------------|
| Phase 0 | Credential vault + audit + adapter interface + settings UI | Nothing — start here |
| Phase 1 | Slack adapter + OAuth + agent tools | Phase 0 |
| Phase 2 | GitHub adapter + App auth + agent tools | Phase 0 (can parallel with Phase 1) |
| Phase 3 | Make.com adapter + agent tools | Phase 0 (can parallel with 1 & 2) |
| Phase 4 | Multi-tool orchestration + deployment sessions | At least 2 adapters done |

> Phases 1, 2, 3 are independent once Phase 0 is done. Can be built in parallel.
