# Taurus Backend

Backend API for **Taurus — AI Transformation Operating System**. Helps organizations assess their AI readiness, plan transformation initiatives, and deploy changes directly to their connected tools — all powered by Claude.

## How It Works

1. **Onboarding** — User signs up via passwordless OTP, creates an org, selects industry
2. **Consultation** — AI generates industry-specific questions, user answers them
3. **Analysis** — AI produces a transformation report with recommendations and maturity scoring
4. **Tracker** — Recommendations become actionable cards on a kanban board (BACKLOG → DEPLOYED → VERIFIED)
5. **Implementation** — AI generates deployment plans with steps, prerequisites, risks, and artifacts
6. **Deployment** — Connected integrations (Slack, GitHub, Make, Notion) execute the plan automatically with dry-run, approval, and rollback

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 |
| Language | TypeScript 5 |
| Database | PostgreSQL 16 (Prisma ORM) |
| Cache / Queue | Redis 7 (ioredis + BullMQ) |
| AI | Anthropic Claude (via `@anthropic-ai/sdk`) |
| Auth | Passwordless OTP via Resend + JWT (access + refresh tokens) |
| Integrations | Slack (`@slack/web-api`), GitHub (`@octokit/rest`), Make.com, Notion (REST APIs) |
| Docs | Swagger (auto-generated at `/api/docs`) |
| Security | Helmet, CORS, rate limiting, AES-256-GCM credential encryption |

## Project Structure

```
src/
├── main.ts                          # Bootstrap, global pipes/filters/interceptors, Swagger
├── app.module.ts                    # Root module
├── config/                          # Typed config factory, Joi env validation
├── prisma/                          # PrismaService (global)
├── redis/                           # RedisService — ioredis wrapper (global)
├── queue/                           # BullMQ — template-gen, analysis, implementation, token-refresh
├── ai/                              # Anthropic SDK wrapper + prompt templates
│   └── tools/                       # Agent tool definitions + executors (22 tools across 4 providers)
├── auth/                            # OTP send/verify, JWT issue/refresh/revoke
├── users/                           # Profile read/update
├── organizations/                   # Org CRUD, member listing
├── consultation/                    # Industry questions, session lifecycle, Q&A flow
├── onboarding/                      # Org onboarding data collection
├── dashboard/                       # Executive dashboard, analytics
├── departments/                     # Department + workflow management
├── tracker/                         # Transformation action kanban board
├── implementation/                  # AI deployment plan generation + artifact creation
├── integrations/                    # Credential vault, OAuth, audit logging
│   └── adapters/                    # Provider adapters (Slack, GitHub, Make, Notion)
│       ├── slack/                   # Channels, messages, webhooks, user invites
│       ├── github/                  # Repos, workflows, webhooks, secrets
│       ├── make/                    # Scenarios, connections, activation
│       └── notion/                  # Pages, databases, items
├── deployment/                      # Multi-tool orchestration engine
├── discovery/                       # Website scraping + AI analysis
├── stack/                           # Tool/tech stack management
├── notifications/                   # Email notifications (Resend)
├── storage/                         # File upload handling
├── health/                          # DB + Redis health check
└── common/                          # Guards, decorators, filters, interceptors
```

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL 16** — local or managed (e.g., Railway)
- **Redis 7** — local or managed (e.g., Railway)
- **Resend** account — for OTP emails
- **Anthropic** API key — for AI features

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/taurus_db

# Redis
REDIS_URL=                          # e.g., redis://default:pass@host:port
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth
JWT_ACCESS_SECRET=<random-64-char-string>
JWT_REFRESH_SECRET=<different-random-64-char-string>
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com

# AI
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_MODEL=claude-sonnet-4-6

# Credential encryption (min 32 chars, required for integrations)
CREDENTIAL_ENCRYPTION_KEY=<random-32-char-string>

# Slack integration (OAuth — create app at api.slack.com)
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

# GitHub integration (OAuth — create app at github.com/settings/developers)
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Make.com and Notion use API key auth — clients enter keys via Settings UI
```

### 3. Set up the database

```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

### 4. Start the server

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build && npm run start:prod
```

The API is available at `http://localhost:3000/api/v1` and Swagger docs at `http://localhost:3000/api/docs`.

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/send-otp` | Public | Send OTP to email |
| POST | `/auth/verify-otp` | Public | Verify OTP, get tokens |
| POST | `/auth/refresh` | Public | Refresh access token |
| POST | `/auth/logout` | JWT | Revoke refresh token |

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users/me` | JWT | Get current user profile |
| PATCH | `/users/me` | JWT | Update profile |

### Organizations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/organizations` | JWT | Create org |
| GET | `/organizations/:id` | JWT + Member | Get org details |
| PATCH | `/organizations/:id` | JWT + Admin | Update org |
| GET | `/organizations/:id/members` | JWT + Member | List members |

### Tracker

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tracker/actions` | JWT | List transformation actions |
| PATCH | `/tracker/actions/:id` | JWT | Update action (status, assignee, etc.) |

### Implementation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/implementation/plans` | JWT | Create deployment plan (AI generates) |
| GET | `/implementation/plans` | JWT | List plans |
| GET | `/implementation/plans/:id` | JWT | Get plan with steps/artifacts |
| POST | `/implementation/plans/:id/approve` | JWT | Approve plan |
| POST | `/implementation/plans/:id/execute` | JWT | Generate artifacts |
| POST | `/implementation/plans/:id/refine` | JWT | Refine with feedback |
| POST | `/implementation/plans/:id/reject` | JWT | Reject plan |

### Integrations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/organizations/:orgId/integrations` | JWT + Member | List connected integrations |
| GET | `/organizations/:orgId/integrations/connect/:provider` | JWT + Member | Start OAuth flow |
| POST | `/organizations/:orgId/integrations/connect-api-key` | JWT + Member | Connect via API key |
| POST | `/organizations/:orgId/integrations/:id/test` | JWT + Member | Test connection |
| DELETE | `/organizations/:orgId/integrations/:id` | JWT + Member | Disconnect |
| GET | `/organizations/:orgId/integrations/audit-logs` | JWT + Member | Audit trail |

### Deployment (Multi-Tool Orchestration)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/organizations/:orgId/deploy` | JWT + Member | Create deployment session |
| GET | `/organizations/:orgId/deploy` | JWT + Member | List sessions (filter by planId) |
| GET | `/organizations/:orgId/deploy/:sessionId` | JWT + Member | Get session with steps |
| POST | `/organizations/:orgId/deploy/:sessionId/dry-run` | JWT + Member | Preview all steps |
| POST | `/organizations/:orgId/deploy/:sessionId/approve` | JWT + Member | Approve after dry-run |
| POST | `/organizations/:orgId/deploy/:sessionId/execute` | JWT + Member | Execute all steps |
| POST | `/organizations/:orgId/deploy/:sessionId/rollback` | JWT + Member | Rollback completed steps |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | DB + Redis connectivity check |

## Agent Tools

The AI implementation engine has 22 tools available across 4 providers:

| Provider | Tools | Auth |
|----------|-------|------|
| **Slack** | `slack_list_channels`, `slack_list_users`, `slack_create_channel`, `slack_post_message`, `slack_invite_to_channel`, `slack_create_webhook` | OAuth |
| **GitHub** | `github_list_repos`, `github_list_workflows`, `github_create_workflow`, `github_create_webhook`, `github_trigger_workflow`, `github_list_secrets` | OAuth |
| **Make.com** | `make_list_scenarios`, `make_list_connections`, `make_create_scenario`, `make_activate_scenario`, `make_test_scenario` | API Key |
| **Notion** | `notion_list_databases`, `notion_search_pages`, `notion_create_page`, `notion_create_database`, `notion_add_database_item` | API Key |

All mutating tools support `dryRun: true` for preview without side effects. Every execution is audit-logged with rollback data.

## Database Schema

Key models:

```
Industry          1──*  Organization
Organization      1──*  User
Organization      1──*  ConsultationSession
Organization      1──*  TransformationAction (tracker board)
Organization      1──*  DeploymentPlan
Organization      1──*  OrgIntegration (encrypted credentials)
Organization      1──*  DeploymentSession

TransformationAction  1──*  DeploymentPlan
DeploymentPlan        1──*  DeploymentArtifact
DeploymentPlan        1──*  DeploymentSession
DeploymentSession     1──*  DeploymentStep

OrgIntegration    1──*  DeploymentAuditLog
```

## Deployment

### Docker

```bash
docker build -t taurus-backend .
docker run -p 3000:3000 --env-file .env taurus-backend
```

### Railway

Set `DATABASE_URL` and `REDIS_URL` from Railway's provisioned variables. For production migrations:

```bash
npx prisma migrate deploy
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start in watch mode |
| `npm run start:prod` | Start production build |
| `npm run build` | Compile TypeScript |
| `npm run lint` | Lint and fix |
| `npm run format` | Format with Prettier |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests |

## License

Private — UNLICENSED
