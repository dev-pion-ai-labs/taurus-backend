# Local Testing Guide

## Prerequisites

- Node.js >= 20
- Railway PostgreSQL URL (from Railway dashboard)
- Railway Redis URL (from Railway dashboard)
- Resend API key (from resend.com)
- Anthropic API key (from console.anthropic.com)

## 1. Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your Railway credentials:

```env
DATABASE_URL=postgresql://postgres:xxxxx@xxxxx.railway.app:5432/railway
REDIS_URL=redis://default:xxxxx@xxxxx.railway.app:6379

JWT_ACCESS_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_REFRESH_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com

ANTHROPIC_API_KEY=sk-ant-xxxxx
```

## 2. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Create tables (first time)
npx prisma migrate dev --name init

# Seed industries, challenge areas, and base template
npx prisma db seed
```

Verify the seed worked:

```bash
npx prisma studio
```

This opens a browser UI — you should see 20 industries, 15 challenge areas, and 1 base template with 7 questions.

## 3. Start the Server

```bash
npm run start:dev
```

You should see:

```
[Nest] LOG [NestApplication] Nest application successfully started
```

## 4. Verify Health

```bash
curl http://localhost:3000/api/v1/health
```

Expected:

```json
{ "data": { "status": "ok", "db": "connected", "redis": "connected" } }
```

If `db` or `redis` shows `disconnected`, double-check your `.env` URLs.

## 5. Test the Full Flow

Open Swagger UI at **http://localhost:3000/api/docs** for an interactive UI, or use the curl commands below.

### 5.1 List Industries (public)

```bash
curl http://localhost:3000/api/v1/industries
```

Should return 20 seeded industries with IDs. Copy one industry ID (e.g., the Healthcare UUID) for later.

### 5.2 Auth — Send OTP

```bash
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

Expected: `{ "data": { "message": "Verification code sent to your email" } }`

> **Note:** You need a verified domain on Resend for emails to send. For local testing, you can check the OTP directly in the database:
> ```bash
> npx prisma studio
> ```
> Open the `otp_codes` table and find the 6-digit code.

### 5.3 Auth — Verify OTP

```bash
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "code": "123456"}'
```

Expected: `{ "data": { "accessToken": "eyJ...", "refreshToken": "uuid-..." } }`

Save the `accessToken` — you need it for all authenticated requests below.

```bash
export TOKEN="eyJ..."
```

### 5.4 Get Profile

```bash
curl http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN"
```

### 5.5 Update Profile

```bash
curl -X PATCH http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "John", "lastName": "Doe"}'
```

### 5.6 Create Organization

Use an industry ID from step 5.1:

```bash
curl -X POST http://localhost:3000/api/v1/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Health", "industryId": "<INDUSTRY_UUID>", "size": "51-200"}'
```

Save the returned org `id`.

### 5.7 Get Organization

```bash
curl http://localhost:3000/api/v1/organizations/<ORG_ID> \
  -H "Authorization: Bearer $TOKEN"
```

### 5.8 Start Consultation Session

```bash
curl -X POST http://localhost:3000/api/v1/consultation/sessions \
  -H "Authorization: Bearer $TOKEN"
```

**Two possible outcomes:**

- **`status: "IN_PROGRESS"`** — industry template already existed. Session has questions ready.
- **`status: "PENDING_TEMPLATE"`** — first org for this industry. AI is generating questions in the background. Wait ~5-10 seconds and GET the session again.

Save the session `id`.

### 5.9 Get Current Question

```bash
curl http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID>/current-question \
  -H "Authorization: Bearer $TOKEN"
```

Returns the first unanswered question with progress counter.

### 5.10 Submit Answer

The answer format depends on the question type:

**TEXT question:**

```bash
curl -X POST http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID>/answers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "<QUESTION_UUID>", "value": "We provide healthcare SaaS products."}'
```

**SINGLE_CHOICE question:**

```bash
curl -X POST http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID>/answers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "<QUESTION_UUID>", "value": "$500K - $2M"}'
```

**MULTI_CHOICE question:**

```bash
curl -X POST http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID>/answers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "<QUESTION_UUID>", "value": ["Sales", "Operations", "R&D"]}'
```

**SCALE question (1-5):**

```bash
curl -X POST http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID>/answers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "<QUESTION_UUID>", "value": 3}'
```

Each response returns the next question. When all questions are answered, the response returns `"status": "COMPLETED"`.

### 5.11 Get Full Session (after completion)

```bash
curl http://localhost:3000/api/v1/consultation/sessions/<SESSION_ID> \
  -H "Authorization: Bearer $TOKEN"
```

Returns the complete session with all questions and answers.

### 5.12 Token Refresh

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<REFRESH_TOKEN>"}'
```

Returns new access + refresh tokens. The old refresh token is revoked.

### 5.13 Logout

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<REFRESH_TOKEN>"}'
```

## 6. Admin-Only Endpoints

After creating an org (which makes you ADMIN):

```bash
# List all templates
curl http://localhost:3000/api/v1/consultation/templates \
  -H "Authorization: Bearer $TOKEN"

# Get specific template with questions
curl http://localhost:3000/api/v1/consultation/templates/<TEMPLATE_ID> \
  -H "Authorization: Bearer $TOKEN"

# Regenerate an industry template (creates new version via AI)
curl -X POST http://localhost:3000/api/v1/consultation/templates/<TEMPLATE_ID>/regenerate \
  -H "Authorization: Bearer $TOKEN"
```

## 7. Quick Smoke Test Checklist

Run these in order to verify the entire system:

| # | Test | Expected |
|---|------|----------|
| 1 | `GET /health` | `status: "ok"`, db + redis connected |
| 2 | `GET /industries` | 20 industries returned |
| 3 | `POST /auth/send-otp` | OTP sent (check DB if email not configured) |
| 4 | `POST /auth/verify-otp` | Access + refresh tokens returned |
| 5 | `GET /users/me` | User profile returned |
| 6 | `PATCH /users/me` | Name updated |
| 7 | `POST /organizations` | Org created, user becomes ADMIN |
| 8 | `GET /organizations/:id` | Org with industry returned |
| 9 | `GET /organizations/:id/members` | 1 member (you) |
| 10 | `POST /consultation/sessions` | Session created (IN_PROGRESS or PENDING_TEMPLATE) |
| 11 | `GET .../current-question` | First question with progress |
| 12 | `POST .../answers` (repeat) | Answer saved, next question returned |
| 13 | Last answer | `status: "COMPLETED"` |
| 14 | `GET /consultation/sessions/:id` | Full session with all Q&As |
| 15 | `POST /auth/refresh` | New tokens, old revoked |
| 16 | `POST /auth/logout` | Refresh token revoked |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `db: "disconnected"` | Check `DATABASE_URL` in `.env`. Ensure Railway DB is publicly accessible. |
| `redis: "disconnected"` | Check `REDIS_URL` in `.env`. Railway Redis may need public networking enabled. |
| OTP email not received | Check Resend dashboard for delivery logs. Use Prisma Studio to read the code directly. |
| `PENDING_TEMPLATE` stuck | Check terminal logs for BullMQ errors. Verify `ANTHROPIC_API_KEY` is valid. |
| `403 Forbidden` on org routes | You must be a member of that org. Create org first (makes you ADMIN). |
| `429 Too Many Requests` | Rate limiter hit. Wait 60 seconds or increase `THROTTLE_LIMIT` in `.env`. |
| Prisma connection timeout | Add `?connection_limit=5&connect_timeout=30` to `DATABASE_URL`. |
