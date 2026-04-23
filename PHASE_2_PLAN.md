# Taurus Backend — Phase 2 Implementation Plan

## Context

Phase 1 built the platform foundation and the consultation data collection pipeline (Module 2 intake). A user can sign up, create an org, and complete a full industry-specific AI-powered consultation — but there's no output. The session ends with `status: COMPLETED` and nothing happens.

Phase 2 turns the collected data into actionable output: AI maturity scores, department-level analysis, dollar-quantified roadmaps, and a live report. This completes **Modules 1-3** of the Taurus v4 vision.

### What Phase 1 Built (reusable in Phase 2)

- Auth, users, orgs, industries, multi-tenancy
- Consultation Q&A with AI-generated templates
- BullMQ async job infrastructure (2 queues, `analysis` queue already exists but is a stub)
- AI service wrapper (Anthropic SDK, retry logic)
- Challenge area tagging on questions
- Response envelope, pagination, error handling

### Phase 2 Goal

**"When a user completes a consultation, they get a full AI transformation report with a maturity score, department breakdown, identified opportunities with dollar values, and a phased implementation roadmap."**

---

## Architecture Decisions

- **Reports are generated once per completed session** — stored in DB, not re-computed on every read
- **Department model added** — organizations have departments, analysis is broken down per department
- **Two-pass AI analysis** — Pass 1: extract structured data from answers (departments, tools, challenges). Pass 2: generate the full report with scoring and recommendations
- **Roadmap actions are individual records** — each recommendation becomes a `RoadmapAction` row, enabling future Module 5 (Transformation Tracker) to convert them into Kanban cards
- **Maturity scoring uses a 0-100 scale** — matching the vision deck (58/100 example)
- **Report generation is async** — uses the existing `analysis` BullMQ queue, so the user isn't blocked

---

## Database Schema Changes

### New Enums

```prisma
enum ReportStatus {
  GENERATING
  COMPLETED
  FAILED
}

enum MaturityLevel {
  AI_UNAWARE       // 0-20
  AI_CURIOUS       // 21-40
  AI_EXPERIMENTING // 41-60
  AI_SCALING       // 61-80
  AI_NATIVE        // 81-100
}

enum ActionPriority {
  QUICK_WIN       // Low effort, high impact
  STRATEGIC       // High effort, high impact
  INCREMENTAL     // Low effort, low impact
  DEFERRED        // High effort, low impact
}

enum ActionStatus {
  IDENTIFIED
  PLANNED
  IN_PROGRESS
  DEPLOYED
  VERIFIED
}

enum RoadmapPhase {
  PHASE_1   // Weeks 1-4: Quick wins
  PHASE_2   // Weeks 5-8: Core initiatives
  PHASE_3   // Weeks 9-12: Strategic plays
  PHASE_4   // Weeks 13+: Long-term
}

enum ValueType {
  EFFICIENCY    // Cost savings, time saved
  GROWTH        // Revenue opportunities
}
```

### New Models

```prisma
model Department {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  name           String
  headCount      Int?     @map("head_count")
  createdAt      DateTime @default(now()) @map("created_at")

  organization      Organization       @relation(fields: [organizationId], references: [id])
  maturityScores    DepartmentScore[]
  roadmapActions    RoadmapAction[]

  @@unique([organizationId, name])
  @@map("departments")
}

model ConsultationReport {
  id        String       @id @default(uuid())
  sessionId String       @unique @map("session_id")
  status    ReportStatus @default(GENERATING)

  // Overall scores
  overallScore    Int            @default(0) @map("overall_score")        // 0-100
  maturityLevel   MaturityLevel  @default(AI_UNAWARE) @map("maturity_level")
  previousScore   Int?           @map("previous_score")                   // For re-assessments

  // Aggregated values
  totalEfficiencyValue  Float   @default(0) @map("total_efficiency_value") // e.g., $1.16M
  totalGrowthValue      Float   @default(0) @map("total_growth_value")     // e.g., $9.2M

  // AI-generated narrative
  executiveSummary  String?  @map("executive_summary")     // 2-3 paragraph overview
  keyFindings       Json?    @map("key_findings")           // Array of finding strings
  strengths         Json?                                    // What the org does well
  gaps              Json?                                    // Where the org falls short

  // AI metadata
  aiModel      String?  @map("ai_model")
  aiPromptHash String?  @map("ai_prompt_hash")
  generatedAt  DateTime? @map("generated_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  session            ConsultationSession   @relation(fields: [sessionId], references: [id])
  departmentScores   DepartmentScore[]
  roadmapActions     RoadmapAction[]

  @@map("consultation_reports")
}

model DepartmentScore {
  id           String @id @default(uuid())
  reportId     String @map("report_id")
  departmentId String @map("department_id")

  score          Int    @default(0)            // 0-100
  aiReadiness    Int    @default(0) @map("ai_readiness")     // Sub-score
  dataMaturity   Int    @default(0) @map("data_maturity")    // Sub-score
  processAutomation Int @default(0) @map("process_automation") // Sub-score
  findings       Json?                          // Department-specific insights
  createdAt      DateTime @default(now()) @map("created_at")

  report     ConsultationReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  department Department          @relation(fields: [departmentId], references: [id])

  @@unique([reportId, departmentId])
  @@map("department_scores")
}

model RoadmapAction {
  id           String         @id @default(uuid())
  reportId     String         @map("report_id")
  departmentId String?        @map("department_id")

  title        String
  description  String
  priority     ActionPriority
  status       ActionStatus   @default(IDENTIFIED)
  phase        RoadmapPhase

  // Value quantification
  valueType        ValueType  @map("value_type")
  estimatedValue   Float      @map("estimated_value")    // Dollar value per year
  estimatedEffort  String     @map("estimated_effort")    // "2 hours", "1 week", "1 month"
  automationLevel  Int?       @map("automation_level")    // % that can be automated (0-100)

  // Implementation details
  toolRecommendation  String?  @map("tool_recommendation")
  prerequisites       Json?                                 // Array of prerequisite action IDs or descriptions
  orderIndex          Int      @map("order_index")

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  report     ConsultationReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  department Department?         @relation(fields: [departmentId], references: [id])

  @@index([reportId, phase])
  @@index([reportId, priority])
  @@map("roadmap_actions")
}
```

### Modified Models

```prisma
// Add to Organization:
departments  Department[]

// Add to ConsultationSession:
report  ConsultationReport?
```

---

## Implementation Steps (in dependency order)

### Step 1: Schema Migration

- Add all new enums and models to `schema.prisma`
- Add `departments` relation to `Organization`
- Add `report` relation to `ConsultationSession`
- Run migration

### Step 2: Department Service

**`src/organizations/departments/`**

- `DepartmentService`:
  - `create(orgId, name, headCount?)` — create a department
  - `list(orgId)` — list org's departments
  - `update(id, dto)` — update name/headCount
  - `delete(id)` — remove department
  - `bulkCreate(orgId, departments[])` — create multiple at once (used by AI during analysis)
- `DepartmentController`:
  - `POST /organizations/:id/departments` — create
  - `GET /organizations/:id/departments` — list
  - `PATCH /organizations/:id/departments/:deptId` — update
  - `DELETE /organizations/:id/departments/:deptId` — delete

These are straightforward CRUD. The AI analysis will also auto-create departments from consultation answers if the org hasn't manually set them up.

### Step 3: Analysis AI Prompts

**`src/ai/prompts/analysis.prompt.ts`**

Two-pass prompt strategy:

**Pass 1 — Structured Extraction:**
Takes all session Q&As and extracts:
```json
{
  "departments": [
    { "name": "Support", "headCount": 12, "currentTools": ["Zendesk"], "painPoints": ["..."] }
  ],
  "currentAiUsage": ["tool1 for X", "tool2 for Y"],
  "challenges": ["change management", "data quality"],
  "budget": "$500K - $2M",
  "techLandscape": "...",
  "digitalMaturity": 3,
  "goals": "..."
}
```

**Pass 2 — Full Analysis:**
Takes the structured extraction + industry context and generates:
```json
{
  "overallScore": 58,
  "maturityLevel": "AI_EXPERIMENTING",
  "executiveSummary": "...",
  "keyFindings": ["...", "..."],
  "strengths": ["...", "..."],
  "gaps": ["...", "..."],
  "departmentScores": [
    {
      "department": "Support",
      "score": 65,
      "aiReadiness": 70,
      "dataMaturity": 55,
      "processAutomation": 68,
      "findings": ["..."]
    }
  ],
  "roadmapActions": [
    {
      "title": "Deploy AI ticket categorization",
      "description": "...",
      "department": "Support",
      "priority": "QUICK_WIN",
      "phase": "PHASE_1",
      "valueType": "EFFICIENCY",
      "estimatedValue": 43000,
      "estimatedEffort": "1 week",
      "automationLevel": 85,
      "toolRecommendation": "Zendesk AI add-on"
    }
  ]
}
```

### Step 4: Analysis Processor (replace stub)

**`src/queue/analysis.processor.ts`** — replace the current dummy with real logic:

1. Load completed session with all Q&As, org, and industry
2. Format answers into a readable context block
3. **Pass 1**: Call Claude — extract structured data (departments, tools, challenges)
4. Auto-create `Department` records if org doesn't have any
5. **Pass 2**: Call Claude — generate full analysis with scores, findings, and roadmap actions
6. Create `ConsultationReport` record with scores and narrative
7. Create `DepartmentScore` records for each department
8. Create `RoadmapAction` records for each recommendation
9. Update report status: `GENERATING` → `COMPLETED`
10. On failure: set report status to `FAILED`, log error

Concurrency: keep at 2 (AI calls are slow, don't want to overload Anthropic rate limits).

### Step 5: Report Service & Controller

**`src/consultation/report/`**

- `ReportService`:
  - `getBySessionId(sessionId, userId)` — get report with all department scores and roadmap actions
  - `getByOrgId(orgId)` — list all reports for an org (for historical comparison)
  - `regenerate(sessionId)` — re-queue analysis for a completed session
  - `getRoadmap(sessionId)` — get just the roadmap actions, grouped by phase
  - `getScoreHistory(orgId)` — maturity score over time for trend tracking
- `ReportController`:
  - `GET /consultation/sessions/:id/report` — full report
  - `POST /consultation/sessions/:id/report/regenerate` — re-run analysis (Admin)
  - `GET /consultation/sessions/:id/roadmap` — roadmap actions grouped by phase
  - `GET /organizations/:id/score-history` — maturity trend over time

### Step 6: AI Service Additions

**`src/ai/ai.service.ts`** — add methods:

- `extractSessionData(answers, industry)` — Pass 1 structured extraction
- `generateAnalysis(extractedData, industry, challengeAreas)` — Pass 2 full analysis

Both follow the same pattern as `generateIndustryQuestions`: structured prompt, JSON output, retry on failure.

### Step 7: Report in Session Flow

Update `SessionService.submitAnswer()`:
- When session completes → create `ConsultationReport` with status `GENERATING` → queue analysis job
- This replaces the current bare `analysisQueue.add('analyze', { sessionId })` with a report-aware flow

Update `SessionService.getSession()`:
- Include the report (if exists) in the session response, so the frontend can show report status

### Step 8: Module 1 — AI Discovery (URL Scanner)

**`src/discovery/`** — Lightweight external scan module

- `DiscoveryService`:
  - `scanUrl(url)` — fetch website, extract signals (tech stack, AI mentions, job postings, company size indicators)
  - `generateSnapshot(scanData, industry?)` — call Claude to produce a quick maturity estimate from public signals
- `DiscoveryController`:
  - `POST /discovery/scan` — public endpoint (or API-key gated), accepts `{ url, industry? }`
  - Returns: quick maturity estimate, detected tech stack, detected industry, suggested next step (full consultation)
- `DiscoveryReport` model:

```prisma
model DiscoveryReport {
  id        String   @id @default(uuid())
  url       String
  industry  String?
  score     Int?                               // Quick estimate 0-100
  techStack Json?    @map("tech_stack")         // Detected tools
  aiSignals Json?    @map("ai_signals")         // AI-related findings
  summary   String?
  createdAt DateTime @default(now()) @map("created_at")

  @@map("discovery_reports")
}
```

This is the top-of-funnel: a prospect pastes their URL, gets an instant AI readiness snapshot, and is invited to do the full Strategy Workshop (consultation) for the detailed report.

### Step 9: Notification Hooks

**`src/notifications/`** — Simple email notifications via Resend (already installed)

- Report ready: "Your AI Transformation Report is ready. View it now."
- Template generated: "Your consultation is ready to begin." (for PENDING_TEMPLATE users)
- Session reminder: "You have an incomplete consultation. Resume where you left off."

No new infrastructure — uses the existing Resend SDK from AuthService, just extracted into a shared `NotificationService`.

---

## New API Endpoints Summary

### Departments (`/organizations/:id/departments`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/organizations/:id/departments` | JWT + Admin | Create department |
| GET | `/organizations/:id/departments` | JWT + Member | List departments |
| PATCH | `/organizations/:id/departments/:deptId` | JWT + Admin | Update department |
| DELETE | `/organizations/:id/departments/:deptId` | JWT + Admin | Delete department |

### Reports (`/consultation/sessions/:id/report`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/consultation/sessions/:id/report` | JWT | Full report with scores + actions |
| POST | `/consultation/sessions/:id/report/regenerate` | JWT + Admin | Re-run AI analysis |
| GET | `/consultation/sessions/:id/roadmap` | JWT | Roadmap actions by phase |

### Score History (`/organizations/:id/score-history`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/organizations/:id/score-history` | JWT + Member | Maturity score over time |

### Discovery (`/discovery`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/discovery/scan` | Public / API Key | Scan URL for AI readiness |
| GET | `/discovery/:id` | Public / API Key | Get scan result |

**Phase 2 total: 10 new endpoints + 1 rebuilt background worker**

---

## AI Prompt Strategy

### Pass 1: Structured Extraction

```
System: You are an AI transformation analyst. Extract structured data
from consultation answers. Output ONLY valid JSON.

User: Here are the consultation answers for a {industry} company
called {orgName} with {size} employees:

{formatted Q&A pairs}

Extract:
- Departments mentioned (with estimated headcount if stated)
- Current AI/tech tools in use
- Key business challenges
- Budget range
- Current digital maturity signals
- Transformation goals

Return JSON with this structure: { departments, currentAiUsage,
challenges, budget, techLandscape, digitalMaturity, goals }
```

### Pass 2: Full Analysis

```
System: You are a senior AI transformation consultant. Generate a
comprehensive analysis with maturity scoring and a quantified
transformation roadmap. Be specific to the {industry} industry.
Score conservatively — most companies score 30-60. Output ONLY valid JSON.

User: Analyze this {industry} company:
{extracted data from Pass 1}

Industry context: {industry benchmarks from challenge areas}
Company size: {size}

Generate:
1. Overall AI maturity score (0-100) with maturity level
2. Executive summary (2-3 paragraphs)
3. Key findings (5-7 bullet points)
4. Strengths and gaps
5. Per-department scores (score, aiReadiness, dataMaturity,
   processAutomation, findings)
6. Transformation roadmap: 15-25 specific, actionable recommendations
   - Each with: title, description, department, priority (QUICK_WIN/
     STRATEGIC/INCREMENTAL/DEFERRED), phase (1-4), valueType
     (EFFICIENCY/GROWTH), estimatedValue (annual $), estimatedEffort,
     automationLevel (%), toolRecommendation
   - Phase 1 (Weeks 1-4): Quick wins — low effort, high impact
   - Phase 2 (Weeks 5-8): Core initiatives
   - Phase 3 (Weeks 9-12): Strategic plays
   - Phase 4 (Weeks 13+): Long-term investments
   - Quantify realistically based on company size and industry

Return JSON matching this structure: { overallScore, maturityLevel,
executiveSummary, keyFindings, strengths, gaps, departmentScores,
roadmapActions }
```

---

## End-to-End Flow After Phase 2

```
1. Prospect scans their URL at POST /discovery/scan
   → Gets instant AI maturity estimate (Module 1)
   → Invited to do full consultation

2. User signs up (OTP), creates org, starts consultation
   → Answers 19+ questions (Module 2 intake — Phase 1)

3. Session completes → analysis job queued
   → Pass 1: AI extracts structured data from answers
   → Pass 2: AI generates full report with scores + roadmap
   → Report stored, email notification sent

4. User views report at GET /sessions/:id/report (Module 2 output)
   → Overall maturity: 58/100 (AI Experimenting)
   → Department heatmap: Support 65, Sales 42, Engineering 71
   → Key findings, strengths, gaps

5. User views roadmap at GET /sessions/:id/roadmap (Module 3)
   → Phase 1: "Deploy AI ticket categorization" — $43K/yr, 1 week
   → Phase 2: "Implement predictive lead scoring" — $180K/yr, 3 weeks
   → ...20 more actions across 4 phases
   → Total value: $1.16M efficiency + $9.2M growth = $10.4M/yr
```

---

## Project Structure (new files)

```
src/
├── discovery/
│   ├── discovery.module.ts
│   ├── discovery.controller.ts
│   ├── discovery.service.ts
│   └── dto/
│       └── scan-url.dto.ts
├── consultation/
│   ├── report/
│   │   ├── report.controller.ts
│   │   ├── report.service.ts
│   │   └── dto/
│   └── ...existing
├── organizations/
│   ├── departments/
│   │   ├── department.controller.ts
│   │   ├── department.service.ts
│   │   └── dto/
│   └── ...existing
├── ai/
│   └── prompts/
│       ├── question-generation.prompt.ts  (existing)
│       ├── analysis-extraction.prompt.ts  (new)
│       ├── analysis-report.prompt.ts      (new)
│       └── discovery-scan.prompt.ts       (new)
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.service.ts
│   └── templates/                         (email HTML templates)
└── queue/
    └── analysis.processor.ts              (rebuilt)
```

---

## Verification Plan

1. **Schema**: Migration runs clean, Prisma Studio shows new tables
2. **Departments**: CRUD operations work, unique constraint on (orgId, name)
3. **Analysis flow**: Complete a session → report auto-generates within 30-60 seconds
4. **Report content**: Scores are 0-100, maturity level matches score, all departments scored
5. **Roadmap**: 15-25 actions generated, sorted by phase, values are realistic for company size
6. **Dollar values**: Total efficiency + growth values shown, per-action breakdowns add up
7. **Discovery scan**: Paste a real company URL → get a maturity estimate + tech stack
8. **Score history**: Complete 2 consultations → GET score-history shows both scores with trend
9. **Report regenerate**: Re-run analysis → new report replaces old, scores may differ slightly
10. **Notifications**: User receives "report ready" email when analysis completes
11. **Error handling**: If AI call fails, report status = FAILED, user sees error state, can retry

---

## Dependencies Between Steps

```
Step 1 (Schema) ─────────────────────────────────────────────┐
    │                                                         │
    ├── Step 2 (Departments) ── standalone CRUD               │
    │                                                         │
    ├── Step 3 (AI Prompts) ── no code deps, just prompts     │
    │       │                                                 │
    │       └── Step 6 (AI Service) ── needs prompts          │
    │               │                                         │
    │               └── Step 4 (Analysis Processor)           │
    │                       │        needs AI + schema        │
    │                       │                                 │
    │                       └── Step 5 (Report Service)       │
    │                               │  needs processor + schema
    │                               │                         │
    │                               └── Step 7 (Session Flow) │
    │                                      wire it all up     │
    │                                                         │
    ├── Step 8 (Discovery) ── independent, can parallel       │
    │                                                         │
    └── Step 9 (Notifications) ── independent, can parallel   │
```

**Critical path**: Steps 1 → 3 → 6 → 4 → 5 → 7
**Parallel work**: Steps 2, 8, 9 can happen alongside the critical path

---

## What This Enables for Phase 3

After Phase 2, the data model supports:

- **Module 5 (Transformation Tracker)**: `RoadmapAction` records with `ActionStatus` can be turned into Kanban cards. Status transitions (IDENTIFIED → PLANNED → IN_PROGRESS → DEPLOYED → VERIFIED) are already in the enum.
- **Module 12 (Executive Dashboard)**: `ConsultationReport` has all the KPIs. `DepartmentScore` enables the heatmap. Score history enables trend tracking.
- **Module 6 (AI Stack Intelligence)**: `toolRecommendation` on roadmap actions seeds the tool inventory. Discovery scan detects current tech stack.
- **Re-assessment cycle**: `previousScore` on report enables "you improved 12 points" messaging from the vision deck.
