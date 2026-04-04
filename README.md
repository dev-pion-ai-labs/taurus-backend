# Taurus Backend

Backend API for **Taurus — AI Transformation Operating System**. Helps organizations assess their AI readiness through industry-aware consultation sessions powered by Claude.

## How It Works

1. User signs up via passwordless OTP email (Resend)
2. Creates an organization and selects their industry
3. System checks if an AI-generated question template exists for that industry
   - If yes — consultation starts instantly
   - If no — Claude generates 10-15 industry-specific questions via BullMQ background job (~5s, first org only)
4. User answers base questions (universal) + industry questions (AI-generated, cached per industry)
5. Session completes — analysis queued for Phase 2

Templates are shared platform resources: generated **once per industry**, then reused for every org. 50 industries = 50 AI calls, not 10,000.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 |
| Language | TypeScript 5 |
| Database | PostgreSQL 16 (Prisma ORM) |
| Cache / Queue | Redis 7 (ioredis + BullMQ) |
| AI | Anthropic Claude (via `@anthropic-ai/sdk`) |
| Auth | Passwordless OTP via Resend + JWT (access + refresh tokens) |
| Docs | Swagger (auto-generated at `/api/docs`) |
| Security | Helmet, CORS, rate limiting (`@nestjs/throttler`) |

## Project Structure

```
src/
├── main.ts                          # Bootstrap, global pipes/filters/interceptors, Swagger
├── app.module.ts                    # Root module
├── config/                          # Typed config factory, Joi env validation
├── prisma/                          # PrismaService (global)
├── redis/                           # RedisService — ioredis wrapper (global)
├── queue/                           # BullMQ setup — template-generation & analysis queues
├── ai/                              # Anthropic SDK wrapper + prompt templates
├── auth/                            # OTP send/verify, JWT issue/refresh/revoke
├── users/                           # Profile read/update
├── organizations/                   # Org CRUD, member listing
├── consultation/
│   ├── industry/                    # Industry list/search (public endpoint for dropdowns)
│   ├── template/                    # Template lookup, AI generation, BullMQ processor
│   ├── session/                     # Session lifecycle, sequential Q&A flow
│   └── challenge/                   # Challenge area tagging for cross-industry matching
├── health/                          # DB + Redis health check
└── common/
    ├── decorators/                  # @CurrentUser(), @Roles()
    ├── guards/                      # JwtAuthGuard, RolesGuard, OrgMemberGuard
    ├── filters/                     # AllExceptionsFilter (Prisma errors → proper HTTP codes)
    ├── interceptors/                # Logging, response envelope ({ data, meta })
    └── dto/                         # PaginationQueryDto
```

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL 16** — local or managed (e.g., Railway)
- **Redis 7** — local or managed (e.g., Railway)
- **Resend** account — for OTP emails
- **Anthropic** API key — for AI question generation

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
# Database — local or Railway PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/taurus_db

# Redis — use REDIS_URL for managed services, or host/port for local
REDIS_URL=                          # e.g., redis://default:pass@host:port
REDIS_HOST=localhost                # ignored when REDIS_URL is set
REDIS_PORT=6379                     # ignored when REDIS_URL is set
REDIS_PASSWORD=                     # ignored when REDIS_URL is set

# Auth
JWT_ACCESS_SECRET=<random-64-char-string>
JWT_REFRESH_SECRET=<different-random-64-char-string>
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com

# AI
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### 3. Set up the database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed industries, challenge areas, and base template
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
| POST | `/organizations` | JWT | Create org (triggers template generation) |
| GET | `/organizations/:id` | JWT + Member | Get org details |
| PATCH | `/organizations/:id` | JWT + Admin | Update org |
| GET | `/organizations/:id/members` | JWT + Member | List members (paginated) |

### Industries

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/industries` | Public | List/search industries |
| GET | `/industries/:id` | Public | Get industry details |

### Consultation Templates

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/consultation/templates` | JWT + Admin | List all templates |
| GET | `/consultation/templates/:id` | JWT | Get template details |
| POST | `/consultation/templates/:id/regenerate` | JWT + Admin | Regenerate template |

### Consultation Sessions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/consultation/sessions` | JWT | Start a consultation |
| GET | `/consultation/sessions` | JWT | List sessions (paginated) |
| GET | `/consultation/sessions/:id` | JWT | Get session with all Q&As |
| GET | `/consultation/sessions/:id/current-question` | JWT | Get next unanswered question |
| POST | `/consultation/sessions/:id/answers` | JWT | Submit answer, get next question |
| PATCH | `/consultation/sessions/:id/abandon` | JWT | Abandon session |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | DB + Redis connectivity check |

## Database Schema

Key models and their relationships:

```
Industry          1──*  Organization
Industry          1──*  ConsultationTemplate (INDUSTRY type)
Organization      1──*  ConsultationSession
User              1──*  ConsultationSession
ConsultationTemplate  1──*  TemplateQuestion
TemplateQuestion  *──*  ChallengeArea (via QuestionChallengeArea)
ConsultationSession   1──*  SessionQuestion
SessionQuestion   *──1  TemplateQuestion
```

20 industries and 15 challenge areas are pre-seeded. A base template with 7 universal questions is seeded on first run.

## Deployment

### Docker

```bash
docker build -t taurus-backend .
docker run -p 3000:3000 --env-file .env taurus-backend
```

### Railway

The app is designed to work with Railway's managed PostgreSQL and Redis. Set `DATABASE_URL` and `REDIS_URL` from Railway's provisioned variables — no other changes needed.

For production migrations, use `prisma migrate deploy` (not `migrate dev`):

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
