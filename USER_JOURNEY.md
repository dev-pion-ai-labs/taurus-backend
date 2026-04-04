# Taurus — Complete User Journey

End-to-end flow from first visit to completed consultation.

## Step 1: Browse Industries (unauthenticated)

```
GET /api/v1/industries?search=health
```

Returns paginated list of 20 seeded industries. Frontend uses this for a dropdown during onboarding. User picks one (save the `id`).

## Step 2: Sign Up / Log In (passwordless OTP)

### 2a. Request OTP

```
POST /api/v1/auth/send-otp
{ "email": "john@acme.com" }
```

- If email is new — creates a `User` record automatically
- If email exists — reuses existing user
- Sends 6-digit OTP via Resend email
- OTP expires in 10 minutes

### 2b. Verify OTP

```
POST /api/v1/auth/verify-otp
{ "email": "john@acme.com", "code": "482917" }
```

Returns:

```json
{ "data": { "accessToken": "eyJ...", "refreshToken": "uuid-..." } }
```

All subsequent requests use `Authorization: Bearer <accessToken>`.

## Step 3: Complete Profile (optional)

```
PATCH /api/v1/users/me
{ "firstName": "John", "lastName": "Doe" }
```

## Step 4: Create Organization

```
POST /api/v1/organizations
{ "name": "Acme Health", "industryId": "<healthcare-uuid>", "size": "51-200" }
```

- Validates the industry exists
- Creates the org
- Makes the user an `ADMIN` and links them to the org
- Returns org with industry details

## Step 5: Start Consultation Session

```
POST /api/v1/consultation/sessions
```

This is where the core logic kicks in. The system:

1. Looks up the user's org and its industry
2. Fetches the **base template** (7 universal questions, seeded)
3. Checks for an **active industry template** for that industry

### Path A — Industry template exists (instant, most common)

- Compiles base questions + industry questions into `SessionQuestion` rows
- Session status = `IN_PROGRESS`
- Returns session with all questions

### Path B — First org in this industry (one-time ~5-10s wait)

- No industry template exists yet
- Creates a template record with status `GENERATING`
- Queues a BullMQ job that calls Claude to generate 10-15 industry-specific questions
- Session status = `PENDING_TEMPLATE`
- Background worker finishes — template becomes `ACTIVE` — session gets compiled and moved to `IN_PROGRESS`

```
Subsequent orgs in the same industry skip this entirely.
The template is generated once and reused.
```

## Step 6: Answer Questions Sequentially

### 6a. Get current question

```
GET /api/v1/consultation/sessions/<SESSION_ID>/current-question
```

Returns:

```json
{
  "status": "IN_PROGRESS",
  "question": {
    "id": "...",
    "section": "BASE",
    "question": {
      "questionText": "Describe your organization's core products or services.",
      "questionType": "TEXT"
    }
  },
  "progress": { "answered": 0, "total": 19 }
}
```

### 6b. Submit answer

The answer format depends on the question type:

**TEXT:**
```
POST /api/v1/consultation/sessions/<SESSION_ID>/answers
{ "questionId": "<QUESTION_UUID>", "value": "We provide healthcare SaaS..." }
```

**SINGLE_CHOICE:**
```json
{ "questionId": "<QUESTION_UUID>", "value": "$500K - $2M" }
```

**MULTI_CHOICE:**
```json
{ "questionId": "<QUESTION_UUID>", "value": ["Sales", "Operations", "R&D"] }
```

**SCALE (1-5):**
```json
{ "questionId": "<QUESTION_UUID>", "value": 3 }
```

Each response returns the **next question** automatically.

### 6c. Question flow

The user answers all questions in order:

| Section | Questions | Source |
|---------|-----------|--------|
| BASE | 1-7 | Universal, hardcoded, seeded |
| INDUSTRY | 8-19+ | AI-generated, specific to the org's industry |

Answer validation is enforced per question type:
- TEXT must be a non-empty string
- SINGLE_CHOICE must be one of the provided options
- MULTI_CHOICE must be a subset of the provided options
- SCALE must be a number between 1 and 5

## Step 7: Session Completes

On the last answer submission, the response changes to:

```json
{ "status": "COMPLETED", "nextQuestion": null }
```

The system:
- Marks session `COMPLETED` with a timestamp
- Queues an analysis job (stub for Phase 2 — real AI analysis coming later)

## Step 8: Review Results

```
GET /api/v1/consultation/sessions/<SESSION_ID>
```

Returns the full session with all questions and answers, organized by section.

---

## Other Flows

### Token Refresh

Access tokens expire after 15 minutes. Use the refresh token to get a new pair:

```
POST /api/v1/auth/refresh
{ "refreshToken": "<uuid>" }
```

Returns new access + refresh tokens. The old refresh token is revoked (token rotation).

### Logout

```
POST /api/v1/auth/logout
{ "refreshToken": "<uuid>" }
```

Revokes the refresh token. Requires a valid access token.

### Abandon Session

```
PATCH /api/v1/consultation/sessions/<SESSION_ID>/abandon
```

Marks a session as `ABANDONED`. Cannot abandon a session that is already `COMPLETED` or `ABANDONED`.

### List Sessions

```
GET /api/v1/consultation/sessions?page=1&limit=20
```

Returns paginated list of all sessions for the user's organization.

### Admin: View Templates

```
GET /api/v1/consultation/templates
```

Lists all templates (BASE + INDUSTRY) with question counts. Admin only.

### Admin: Regenerate Industry Template

```
POST /api/v1/consultation/templates/<TEMPLATE_ID>/regenerate
```

Deprecates the current template and generates a new version via Claude. Admin only. Does not affect existing sessions (they keep the old template version).

### View Organization Members

```
GET /api/v1/organizations/<ORG_ID>/members?page=1&limit=20
```

### Update Organization

```
PATCH /api/v1/organizations/<ORG_ID>
{ "name": "New Name", "size": "201-500" }
```

Admin only.

---

## API Call Sequence (minimum happy path)

| # | Method | Endpoint | Auth | Purpose |
|---|--------|----------|------|---------|
| 1 | GET | `/industries` | No | Show industry dropdown |
| 2 | POST | `/auth/send-otp` | No | Send login code |
| 3 | POST | `/auth/verify-otp` | No | Get tokens |
| 4 | PATCH | `/users/me` | JWT | Set name |
| 5 | POST | `/organizations` | JWT | Create org |
| 6 | POST | `/consultation/sessions` | JWT | Start consultation |
| 7 | GET | `.../current-question` | JWT | Get first question |
| 8 | POST | `.../answers` | JWT | Submit answer (repeat ~19x) |
| 9 | GET | `.../sessions/:id` | JWT | Review completed session |

**Total: 9 distinct endpoints, ~28 API calls** for a complete onboarding and consultation.

---

## Session Status Lifecycle

```
PENDING_TEMPLATE ──(template generated)──> IN_PROGRESS ──(all answered)──> COMPLETED
                                            │
                                            └──(user abandons)──> ABANDONED
```

## Template Reuse Model

```
Industry: Healthcare
  └── Template v1 (ACTIVE, 12 questions)
        ├── Org A Session → uses v1
        ├── Org B Session → uses v1 (same questions, no AI call)
        └── Org C Session → uses v1

Admin regenerates:
  └── Template v1 (DEPRECATED)
  └── Template v2 (ACTIVE, 14 questions)
        └── Org D Session → uses v2
```

Existing sessions keep their template version. New sessions get the latest active version.
