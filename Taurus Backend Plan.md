# Taurus Backend — Phase 1 Implementation Plan

## Context

Building a greenfield production-grade backend for **Taurus — AI Transformation Operating System**. The repo is empty. This plan covers the full Phase 1 foundation: auth, org management, industry-aware AI-powered consultation system, and async infrastructure. Designed to support any industry and scale to 10k+ orgs from day 1.

**Core design principle**: Templates are shared platform resources, not per-org. AI generates industry-specific questions **once per industry**, then stores and reuses them for every org in that industry. Hardcoded base questions cover universal needs. This is 200x cheaper than per-org generation at scale.

---

## Architecture Decisions

- **Prisma as shared module** — single `PrismaService` injected by domain modules
- **UUIDs** for all PKs — prevents enumeration, works in distributed systems
- **Access token (15min) + Refresh token (7d, hashed in DB)** — stateless auth with server-side revocation
- **Templates are shared, not per-org** — BASE template (hardcoded, universal) + INDUSTRY templates (AI-generated once per industry, reused)
- **Industry as reference table** — normalized lookup with aliases, not free-text or enum
- **SessionQuestion join table** — freezes question order per session, decouples from template updates
- **Challenge area tags** — questions tagged with challenge areas for cross-industry "similar issues" matching
- **All queries scoped by `organizationId`** — multi-tenancy enforced at service layer
- **Global API prefix `/api/v1`** — versioned from the start
- **Consistent response envelope** — `{ data, meta }` for success, `{ statusCode, message, errors }` for errors

---

## Consultation Flow (Core Design)

### How it works

1. **Org creation** — user provides industry (from searchable dropdown of known industries + "Other" with free text). Industry resolved to `Industry` record via normalization.

2. **Template check** — system checks if an ACTIVE industry template exists for that industry.
   - **Exists** → ready for consultation immediately
   - **Doesn't exist** → BullMQ job queued to generate via Anthropic API. First org waits briefly (3-8s loading state).

3. **Start consultation** — session compiled with two sections:
   - **Section 1: Base questions** (hardcoded, universal, ~7 questions) — collect org context: products, business functions, tech landscape, challenges, AI goals
   - **Section 2: Industry questions** (AI-generated, cached, ~10-15 questions) — industry-specific deep dive

4. **Answer questions sequentially** — submit answer → get next question → repeat until complete.

5. **On completion** — analysis job queued (dummy for Phase 1, real AI in Phase 2).

### Why this approach

| Metric | Per-Org Generation | Per-Industry + Reuse |
|--------|-------------------|---------------------|
| 10k orgs, 50 industries | 10,000 AI calls (~$250) | 50 AI calls (~$1.25) |
| Onboarding latency | 3-8s every time | Instant (except first org per industry) |
| Consistency | Varies per org | Same quality within industry |
| Template curation | Impossible at scale | Admin can review & improve |

### AI Prompt Strategy (for industry template generation)

Prompt instructs Claude to:
- Generate 10-15 questions specific to the target industry
- Cover: current processes, industry pain points, regulatory/compliance, data maturity, workforce readiness
- Mix question types: TEXT (~50%), SINGLE_CHOICE/MULTI_CHOICE (~35%), SCALE (~15%)
- Tag each question with challenge area(s) from a provided list
- Return structured JSON with questionText, questionType, options, challengeAreaTags, rationale
- Generate questions that are industry-specific (universal questions handled separately by base template)

Prompt hash stored on template record for versioning — when prompt improves, can identify which templates need regeneration.

---

## Project Structure

```
taurus-backend/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                         # seeds industries, base template, challenge areas
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── decorators/                 # @CurrentUser(), @Roles()
│   │   ├── guards/                     # JwtAuthGuard, RolesGuard, OrgMemberGuard
│   │   ├── filters/                    # AllExceptionsFilter
│   │   ├── interceptors/               # LoggingInterceptor, TransformResponseInterceptor
│   │   ├── middleware/                 # RequestLoggerMiddleware
│   │   └── dto/                        # PaginationQueryDto, PaginatedResponseDto
│   ├── config/                         # ConfigModule, env validation, typed config factory
│   ├── prisma/                         # PrismaModule + PrismaService
│   ├── redis/                          # RedisModule + RedisService (ioredis)
│   ├── queue/                          # BullMQ setup + shared queue config
│   ├── ai/                             # Anthropic SDK wrapper
│   │   ├── ai.module.ts
│   │   ├── ai.service.ts              # wraps @anthropic-ai/sdk client
│   │   └── prompts/
│   │       └── question-generation.prompt.ts
│   ├── auth/                           # AuthModule: signup, login, refresh, logout
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── dto/
│   ├── users/                          # UsersModule: profile CRUD
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── dto/
│   ├── organizations/                  # OrganizationsModule: org CRUD, members
│   │   ├── organizations.module.ts
│   │   ├── organizations.controller.ts
│   │   ├── organizations.service.ts
│   │   └── dto/
│   └── consultation/                   # ConsultationModule: the core
│       ├── consultation.module.ts
│       ├── session/
│       │   ├── session.controller.ts
│       │   ├── session.service.ts      # session lifecycle, question progression
│       │   └── dto/
│       ├── template/
│       │   ├── template.controller.ts
│       │   ├── template.service.ts     # template lookup, session compilation
│       │   ├── template-generator.service.ts   # builds prompt, calls AiService
│       │   ├── template-generator.processor.ts # BullMQ consumer
│       │   └── dto/
│       ├── industry/
│       │   ├── industry.controller.ts  # list/search industries
│       │   ├── industry.service.ts     # resolution, normalization, alias matching
│       │   └── dto/
│       └── challenge/
│           └── challenge.service.ts    # challenge area matching (Phase 1: tag-based)
└── test/
    └── app.e2e-spec.ts
```

---

## Database Schema (Prisma)

### Enums
- `Role`: ADMIN, MEMBER
- `TemplateType`: BASE, INDUSTRY
- `TemplateStatus`: GENERATING, ACTIVE, DEPRECATED
- `QuestionType`: TEXT, SINGLE_CHOICE, MULTI_CHOICE, SCALE
- `SessionStatus`: PENDING_TEMPLATE, IN_PROGRESS, COMPLETED, ABANDONED
- `QuestionSection`: BASE, INDUSTRY, CHALLENGE_BONUS

### Models

**Industry** — id (uuid), name ("Healthcare"), normalizedKey (unique, "healthcare"), aliases (string[]), createdAt
> Reference table. Searchable dropdown on frontend. Normalized for template lookup. ~20 pre-seeded.

**Organization** — id (uuid), name, industryId (FK → Industry), size?, createdAt, updatedAt
> Industry is required, selected at org creation. Links to Industry reference table.

**User** — id (uuid), email (unique), passwordHash, firstName, lastName, role (ADMIN/MEMBER), organizationId (FK), timestamps

**RefreshToken** — id (uuid), tokenHash (unique), userId (FK), expiresAt, revokedAt?, createdAt

**ConsultationTemplate** — id (uuid), type (BASE/INDUSTRY), status (GENERATING/ACTIVE/DEPRECATED), version (int), industryId (FK?, null for BASE), aiModel?, aiPromptHash?, generatedAt?, timestamps
> Shared platform resource. No organizationId.
> BASE: exactly one, seeded. INDUSTRY: one active per industry, AI-generated on first demand.
> Unique constraint on (type, industryId, version).

**TemplateQuestion** — id (uuid), templateId (FK), questionText, questionType, options (json?), orderIndex (int), isRequired (default true), metadata (json?), createdAt
> Belongs to a template. Ordered within template. Never mutated — new version = new records.

**ChallengeArea** — id (uuid), name ("Change Management"), normalizedKey (unique), description?, createdAt
> Reference table. ~15-20 pre-seeded. Used for cross-industry question matching.

**QuestionChallengeArea** — questionId (FK), challengeAreaId (FK) — composite PK
> Many-to-many join. AI tags each generated question with relevant challenge areas.

**ConsultationSession** — id (uuid), organizationId (FK), userId (FK), status, baseTemplateId (FK), industryTemplateId (FK?), startedAt, completedAt?, timestamps
> Tracks which template versions were used. industryTemplateId null if PENDING_TEMPLATE.

**SessionQuestion** — id (uuid), sessionId (FK), questionId (FK → TemplateQuestion), section (BASE/INDUSTRY/CHALLENGE_BONUS), orderIndex (int), answer (json?), answeredAt?, skipped (default false), timestamps
> Join table. Created at session start — freezes question order. Answers stored here alongside question reference.
> Unique constraint on (sessionId, questionId).

### Key Relations
```
Industry          1──* Organization
Industry          1──* ConsultationTemplate (INDUSTRY type)
ConsultationTemplate 1──* TemplateQuestion
TemplateQuestion  *──* ChallengeArea (via QuestionChallengeArea)
Organization      1──* ConsultationSession
User              1──* ConsultationSession
ConsultationSession *──1 ConsultationTemplate (base)
ConsultationSession *──0..1 ConsultationTemplate (industry)
ConsultationSession 1──* SessionQuestion
SessionQuestion   *──1 TemplateQuestion
User              1──* RefreshToken
```

### Key Indexes
- `industries.normalizedKey` (unique)
- `organizations.industryId`
- `users.organizationId`, `users.email` (unique)
- `refresh_tokens.userId`, `refresh_tokens.expiresAt`
- `consultation_templates.(type, industryId, version)` (unique)
- `template_questions.(templateId, orderIndex)`
- `consultation_sessions.organizationId`, `.status`
- `session_questions.(sessionId, orderIndex)`, `.(sessionId, questionId)` (unique)

---

## Implementation Steps (in dependency order)

### Step 1: Project Scaffolding
- `npx @nestjs/cli new taurus-backend --strict --skip-git --package-manager npm`
- Install deps:
  - Core: `@prisma/client`, `@nestjs/config`, `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`, `bcrypt`, `class-validator`, `class-transformer`, `uuid`
  - Queue: `bullmq`, `ioredis`, `@nestjs/bullmq`
  - AI: `@anthropic-ai/sdk`
  - Docs: `@nestjs/swagger`, `swagger-ui-express`
  - Security: `@nestjs/throttler`, `helmet`
  - Dev: `prisma`, `@types/passport-jwt`, `@types/bcrypt`, `@types/uuid`
- Create `.gitignore`, `.env.example`, `docker-compose.yml` (Postgres 16 + Redis 7 + app), `Dockerfile`
- Init Prisma, init git repo

### Step 2: Config Module
- `src/config/configuration.ts` — typed config factory: database, redis, jwt, app, ai (anthropicApiKey, anthropicModel)
- `src/config/env.validation.ts` — Joi schema (includes ANTHROPIC_API_KEY)
- `src/config/config.module.ts` — `ConfigModule.forRoot({ isGlobal: true })`

### Step 3: Prisma Module
- Write full `prisma/schema.prisma` (all models above)
- Run initial migration
- `src/prisma/prisma.service.ts` — extends PrismaClient, OnModuleInit/OnModuleDestroy
- `src/prisma/prisma.module.ts` — @Global, exports PrismaService

### Step 4: Redis Module
- `src/redis/redis.service.ts` — ioredis client from ConfigService
- `src/redis/redis.module.ts` — @Global, exports RedisService

### Step 5: Common Utilities
- `AllExceptionsFilter` — handles HttpException, Prisma errors (unique constraint → 409, not found → 404), unknown → 500
- `TransformResponseInterceptor` — wraps in `{ data, meta }`
- `LoggingInterceptor` — logs method, URL, duration, status
- `PaginationQueryDto` / `PaginatedResponseDto`
- `@CurrentUser()` decorator, `@Roles()` decorator
- `JwtAuthGuard`, `RolesGuard`, `OrgMemberGuard`
- Register globals in `main.ts`: ValidationPipe, AllExceptionsFilter, LoggingInterceptor, TransformResponseInterceptor, Helmet, ThrottlerGuard, CORS, prefix `/api/v1`, Swagger at `/api/docs`

### Step 6: Users Module
- `UsersService`: create, findByEmail, findById, findByOrganization (paginated), update
- `UsersController`: `GET /users/me`, `PATCH /users/me`
- Exports `UsersService` for Auth to consume

### Step 7: Auth Module
- `JwtStrategy` (Passport) — extracts Bearer token, validates, attaches user to request
- `AuthService`: signup (hash + create + tokens), login (verify + tokens), refreshTokens (rotation), logout (revoke), revokeAllTokens(userId)
- `AuthController`: `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`
- DTOs: SignupDto, LoginDto, RefreshTokenDto, AuthResponseDto

### Step 8: Organizations Module
- `OrganizationsService`: create (resolves industry, user becomes ADMIN, triggers template generation if needed), findById, update, getMembers (paginated), inviteMember (stub)
- `OrganizationsController`: `POST /organizations`, `GET /:id`, `PATCH /:id`, `GET /:id/members`, `POST /:id/invite`
- Org creation body includes `industryId` (from dropdown) or `industryName` (free text for "Other")
- On creation: calls `IndustryService.resolve()` to normalize and match/create industry, then checks if industry template exists — if not, queues generation

### Step 9: AI Module (Anthropic Integration)
- `src/ai/ai.service.ts`:
  - Wraps `@anthropic-ai/sdk` Anthropic client
  - `generateIndustryQuestions(industryName: string, challengeAreas: string[]): Promise<GeneratedQuestion[]>`
  - Calls Claude with structured prompt, parses JSON response
  - Error handling: 1 retry, 30s timeout, returns error on failure
- `src/ai/prompts/question-generation.prompt.ts`:
  - Builds system + user prompt
  - Includes industry name, available challenge area tags
  - Instructs: 10-15 industry-specific questions, mixed types, tagged with challenge areas
  - Output: structured JSON
- `src/ai/ai.module.ts` — exports AiService

### Step 10: Consultation Module — Industry & Challenge Services
- **IndustryService**:
  - `resolve(input: string): Industry` — normalize key → exact match → alias match → create new
  - `normalizeKey(input)`: lowercase, strip punctuation, collapse whitespace to underscore
  - `list(search?, pagination)`: searchable list for frontend dropdown
  - `findById(id)`: single lookup
- **IndustryController**:
  - `GET /industries` — list/search industries (public or JWT, for signup dropdown)
  - `GET /industries/:id` — get industry details
- **ChallengeService**:
  - `list()`: all challenge areas
  - `findByKeys(keys[])`: lookup by normalized keys

### Step 11: Consultation Module — Template Service & Generation
- **TemplateService**:
  - `getBaseTemplate()`: returns the seeded BASE template with questions
  - `getIndustryTemplate(industryId)`: looks up ACTIVE industry template
  - `compileSessionQuestions(baseTemplate, industryTemplate?): SessionQuestion[]`: merges base + industry questions into ordered list with section tags
  - `getTemplate(templateId)`: get template with question count and status
  - `listTemplates(filters, pagination)`: admin listing
- **TemplateGeneratorService**:
  - `generateForIndustry(industryId)`: creates template record (status=GENERATING), enqueues BullMQ job, returns template
  - `regenerate(industryId)`: creates new version, enqueues job
- **TemplateGeneratorProcessor** (BullMQ consumer for `template-generation` queue):
  1. Check if template already ACTIVE (deduplication — skip if so)
  2. Load industry name + challenge areas from DB
  3. Call `AiService.generateIndustryQuestions()`
  4. Bulk-create TemplateQuestion records linked to template
  5. Create QuestionChallengeArea join records (from AI tags)
  6. Update template status: GENERATING → ACTIVE (or FAILED)
  7. If any sessions are PENDING_TEMPLATE for this industry → compile their questions, update to IN_PROGRESS

### Step 12: Consultation Module — Session Service
- **SessionService**:
  - `startSession(userId, orgId)`:
    1. Look up org's industry
    2. Fetch base template
    3. Fetch industry template for that industry
    4. If industry template ACTIVE → compile SessionQuestion rows, status = IN_PROGRESS
    5. If industry template GENERATING → create session with status = PENDING_TEMPLATE (questions compiled when template completes)
    6. If no industry template → trigger generation, status = PENDING_TEMPLATE
    7. Return session with status and first question (if IN_PROGRESS)
  - `getSession(sessionId, userId)` — full session with all questions and answers
  - `getCurrentQuestion(sessionId, userId)` — returns first unanswered SessionQuestion
  - `submitAnswer(sessionId, userId, questionId, dto)`:
    1. Validate session ownership, status = IN_PROGRESS
    2. Validate answer by question type (TEXT→string, SINGLE_CHOICE→string in options, MULTI_CHOICE→string[] subset of options, SCALE→int 1-5)
    3. Save answer + answeredAt on SessionQuestion row
    4. Determine next: find next unanswered SessionQuestion by orderIndex
    5. If none remaining → mark session COMPLETED, set completedAt, queue analysis job
    6. Return next question or completion status
  - `listSessions(orgId, pagination)` — list for org
  - `abandonSession(sessionId, userId)` — set status = ABANDONED
- **SessionController**:
  - `POST /consultation/sessions` — start session
  - `GET /consultation/sessions` — list sessions (paginated)
  - `GET /consultation/sessions/:id` — get session with questions & answers
  - `GET /consultation/sessions/:id/current-question` — current question
  - `POST /consultation/sessions/:id/answers` — submit answer
  - `PATCH /consultation/sessions/:id/abandon` — abandon session

### Step 13: BullMQ Queue Infrastructure
- `QueueModule` — registers BullMQ with Redis, registers queues:
  - `template-generation` — generates industry templates via Anthropic (concurrency: 3, retry: 3 with exponential backoff)
  - `analysis` — analyzes completed sessions (dummy for Phase 1)
- **AnalysisProducer** — `queueAnalysis(sessionId)` adds job
- **AnalysisConsumer** — logs "Processing analysis for session {id}" (dummy)
- Deduplication on template-generation: processor checks template status before calling AI

### Step 14: Database Seed
- `prisma/seed.ts`:
  - **Industries** (~20): Healthcare, Financial Services, Retail & E-Commerce, Manufacturing, Technology & SaaS, Education, Government & Public Sector, Real Estate, Legal Services, Logistics & Supply Chain, Energy & Utilities, Media & Entertainment, Telecommunications, Agriculture, Hospitality & Tourism, Construction, Professional Services, Non-Profit, Automotive, Pharma & Biotech
    - Each with normalizedKey and relevant aliases
  - **Challenge Areas** (~15): Change Management, Data Quality, Legacy Systems, Customer Experience, Operational Efficiency, Compliance & Regulation, Workforce Training, Cost Reduction, Process Automation, Decision Making, Security & Privacy, Scalability, Innovation Speed, Supply Chain Optimization, Revenue Growth
  - **BASE template** (type=BASE, status=ACTIVE) with 7 universal questions:
    1. "Describe your organization's core products or services" (TEXT, order 10)
    2. "What are your primary business functions?" (MULTI_CHOICE: Sales, Marketing, Operations, Customer Support, Finance, HR, R&D, Manufacturing, Logistics, Other — order 20)
    3. "What is your organization's current annual technology budget range?" (SINGLE_CHOICE: <$100K, $100K-$500K, $500K-$2M, $2M-$10M, $10M+ — order 30)
    4. "Describe your current technology landscape and key tools/platforms" (TEXT, order 40)
    5. "What are the top challenges your organization faces today?" (TEXT, order 50)
    6. "How would you rate your organization's overall digital maturity?" (SCALE 1-5, order 60)
    7. "What does a successful AI transformation look like for your organization?" (TEXT, order 70)

### Step 15: Health Check & Final Wiring
- `GET /api/v1/health` — checks DB + Redis connectivity
- Complete `main.ts` bootstrap
- Complete `app.module.ts` imports in dependency order:
  ```
  ConfigModule → PrismaModule → RedisModule → QueueModule → AiModule
  → UsersModule → AuthModule → OrganizationsModule → ConsultationModule
  ```
- Swagger at `/api/docs`
- README with setup/run instructions

---

## API Endpoints Summary

All prefixed with `/api/v1`.

### Auth (`/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | Public | Register |
| POST | `/auth/login` | Public | Login |
| POST | `/auth/refresh` | Public | Refresh tokens |
| POST | `/auth/logout` | JWT | Revoke refresh token |

### Users (`/users`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/me` | JWT | Get profile |
| PATCH | `/users/me` | JWT | Update profile |

### Organizations (`/organizations`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations` | JWT | Create org (triggers template gen if needed) |
| GET | `/organizations/:id` | JWT+Member | Get org with industry info |
| PATCH | `/organizations/:id` | JWT+Admin | Update org |
| GET | `/organizations/:id/members` | JWT+Member | List members |
| POST | `/organizations/:id/invite` | JWT+Admin | Invite (stub) |

### Industries (`/industries`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/industries` | Public | List/search industries (for signup dropdown) |
| GET | `/industries/:id` | Public | Get industry details |

### Consultation — Templates (`/consultation/templates`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/consultation/templates` | JWT+Admin | List all templates (admin) |
| GET | `/consultation/templates/:id` | JWT | Get template with question count |
| POST | `/consultation/templates/:id/regenerate` | JWT+Admin | Regenerate industry template |

### Consultation — Sessions (`/consultation/sessions`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/consultation/sessions` | JWT | Start session |
| GET | `/consultation/sessions` | JWT | List sessions (paginated) |
| GET | `/consultation/sessions/:id` | JWT+Owner | Get session with questions & answers |
| GET | `/consultation/sessions/:id/current-question` | JWT+Owner | Current question |
| POST | `/consultation/sessions/:id/answers` | JWT+Owner | Submit answer, get next question |
| PATCH | `/consultation/sessions/:id/abandon` | JWT+Owner | Abandon session |

---

## End-to-End User Journey (Phase 1)

```
1. GET /industries → user sees list of 20 industries in signup dropdown

2. POST /auth/signup → user registered

3. POST /organizations { name, industryId: "<healthcare-uuid>", size: "51-200" }
   → Org created, user becomes ADMIN
   → System checks: industry template for Healthcare?
     → If NO: BullMQ job queued → Anthropic generates 10-15 healthcare questions
       → Stored as ConsultationTemplate (type=INDUSTRY, status=ACTIVE)
     → If YES: ready immediately

4. POST /consultation/sessions
   → System compiles: 7 base questions + 12 healthcare industry questions = 19 total
   → SessionQuestion rows created (frozen order)
   → Returns session with first question

5. GET /consultation/sessions/:id/current-question
   → "Describe your organization's core products or services" (BASE, TEXT)

6. POST /consultation/sessions/:id/answers { questionId, value: "We provide..." }
   → Answer saved, returns next question
   → "What are your primary business functions?" (BASE, MULTI_CHOICE)

7. ... user answers all 7 base questions ...

8. Next question automatically transitions to industry section:
   → "How do you currently manage patient health records?" (INDUSTRY, TEXT)

9. ... user answers all 12 industry questions ...

10. Last answer submitted → session status = COMPLETED
    → Analysis job queued (dummy log for Phase 1)

11. GET /consultation/sessions/:id → full session with all 19 Q&As
```

**Second healthcare org signs up later:**
- Step 3: template already exists → instant
- Step 4: session starts immediately, no waiting

---

## "Similar Issues" Matching (Phase 1 → Phase 2)

### Phase 1 (implemented)
- AI tags each generated question with challenge area(s) during template generation
- Tags stored in `QuestionChallengeArea` join table
- Base questions capture org's specific challenges as free text
- All orgs in same industry get same industry questions (simple, consistent)

### Phase 2 (future, no schema changes needed)
- After base questions answered, parse org's reported challenges
- Match to ChallengeArea records
- Pull CHALLENGE_BONUS questions from OTHER industry templates that share those challenge tags
- Append to session as bonus section
- Example: Healthcare org reports "supply chain" challenge → pulls relevant questions from Manufacturing template
- Later: pgvector embeddings for semantic similarity matching

---

## .env.example

```
# Application
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:3001

# Database
DATABASE_URL=postgresql://taurus:taurus_secret@localhost:5432/taurus_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_ACCESS_SECRET=change-me-to-a-64-character-random-string
JWT_REFRESH_SECRET=change-me-to-a-different-64-character-random-string
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Anthropic AI
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_MODEL=claude-sonnet-4-6

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=60
```

---

## Verification Plan

1. **Infra**: `docker compose up -d` → `npx prisma migrate dev` → `npx prisma db seed` → `npm run start:dev` boots clean
2. **Swagger**: `GET /api/docs` loads interactive API docs
3. **Health**: `GET /api/v1/health` → `{ status: "ok", db: "connected", redis: "connected" }`
4. **Industries**: `GET /api/v1/industries` → returns 20 seeded industries
5. **Auth flow**: signup → login → token on `/users/me` → refresh → logout → refresh fails (401)
6. **Org flow**: create org with industryId → user becomes ADMIN → template generation triggered for that industry → verify BullMQ job processes → template status becomes ACTIVE
7. **Consultation flow**: start session → verify 7 base + N industry questions compiled → answer all → session completes → analysis job logged
8. **Template reuse**: create second org with same industry → session starts instantly (no AI call, same template)
9. **New industry**: create org with "Other" industry → new Industry record created → template generated → consultation works
10. **Error handling**: malformed JSON (400), unknown route (404), wrong org (403), duplicate answer (409), template still GENERATING (session status = PENDING_TEMPLATE)
11. **Pagination**: list sessions with `?page=2&limit=10` → correct slice and meta
12. **Rate limiting**: rapid-fire auth requests → 429 after threshold
