# Taurus Frontend — Full Implementation Prompt

## Project Overview

Build the complete frontend for **Taurus — AI Transformation Operating System**. This is a B2B SaaS platform where organizations sign up, select their industry, and complete an AI-powered consultation to assess their AI transformation readiness.

The backend is fully built and running at `http://localhost:3000`. All 17 APIs are working. Your job is to build the Next.js frontend that integrates with every endpoint.

---

## Tech Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS v4** + **shadcn/ui** for all components
- **TanStack Query (React Query)** for all API calls
- **React Hook Form + Zod** for form validation
- **Zustand** for auth/user state
- **Lucide React** for icons
- **Plus Jakarta Sans** font (via `next/font/google`)

---

## Design System

Clean, airy SaaS dashboard aesthetic inspired by Orbital/Notion-style interfaces:

### Colors

- **Page background**: `#F5F5F4` (warm stone-50, the overall page canvas)
- **Card/panel background**: `#FFFFFF` (white, for content cards, sidebar, modals)
- **Sidebar background**: `#FFFFFF` with right border `#E7E5E4`
- **Primary text**: `#1C1917` (stone-900, near-black)
- **Secondary text**: `#78716C` (stone-500, muted labels and descriptions)
- **Tertiary text**: `#A8A29E` (stone-400, timestamps, placeholders)
- **Borders**: `#E7E5E4` (stone-200, subtle and warm)
- **Dividers**: `#F5F5F4` (stone-100, very subtle)
- **Primary button**: `#1C1917` background, `#FFFFFF` text (dark, authoritative)
- **Secondary button**: `#FFFFFF` background, `#1C1917` text, `#E7E5E4` border
- **Active/selected state**: `#FFF1F2` background with `#E11D48` text (rose tint — used for active sidebar items, selected tabs)
- **Accent rose**: `#E11D48` (rose-600, for active indicators, highlighted icons, active nav items)
- **Accent amber**: `#F59E0B` (amber-500, for warning badges, "See more" links, secondary CTAs)
- **Status — Confirmed/Success**: `#0D9488` background, `#FFFFFF` text (teal-600, pill badge)
- **Status — Pending/Warning**: `#EA580C` background, `#FFFFFF` text (orange-600, pill badge)
- **Status — In Progress**: `#1C1917` background, `#FFFFFF` text (dark pill badge)
- **Status — Completed**: `#0D9488` background, `#FFFFFF` text (teal pill badge)
- **Status — Abandoned**: `#A8A29E` background, `#FFFFFF` text (stone-400 pill badge)
- **Error**: `#EF4444` (red-500)
- **Hover states**: `#F5F5F4` background on rows, `#FAFAF9` on sidebar items

### Typography

- **Font family**: `Plus Jakarta Sans` (via `next/font/google`, import as `Plus_Jakarta_Sans`), weights 400, 500, 600, 700
- **Page titles**: 24px, weight 600, `#1C1917`
- **Section headings**: 16px, weight 600, `#1C1917`
- **Body text**: 14px, weight 400, `#1C1917`
- **Labels/captions**: 13px, weight 500, `#78716C`
- **Small/metadata**: 12px, weight 400, `#A8A29E`
- **Table headers**: 13px, weight 500, `#78716C`, uppercase letter-spacing `0.05em`

### Shapes & Radius

- **Cards/panels**: `12px` border-radius, `1px` solid `#E7E5E4` border, NO shadow or very subtle `shadow-sm`
- **Buttons**: `8px` border-radius
- **Input fields**: `8px` border-radius, `1px` solid `#E7E5E4` border, `#F5F5F4` background on focus
- **Status badges**: Full pill — `9999px` border-radius, 10px horizontal padding, 4px vertical, uppercase, 11px font, weight 600
- **Sidebar nav items**: `8px` border-radius, `8px 12px` padding
- **Active sidebar item**: `#FFF1F2` background, `#E11D48` text color, subtle rose tint
- **Avatars**: Full circle
- **Tabs/view switchers**: Inline row of buttons with `8px` radius, active tab gets subtle bottom border or filled background

### Shadows & Elevation

- **Level 0** (default): No shadow, border only (`1px solid #E7E5E4`)
- **Level 1** (cards, dropdowns): `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)`
- **Level 2** (modals, popovers): `0 4px 12px rgba(0,0,0,0.08)`
- Prefer borders over shadows. The aesthetic is flat with structure coming from borders and background color changes, not drop shadows.

### Layout Principles

- **Generous whitespace** — 24px padding inside cards, 16px gaps between cards
- **Clean table design** — no alternating row colors, subtle bottom border per row (`#F5F5F4`), hover row highlight (`#FAFAF9`)
- **Toolbar rows** — icon buttons in a horizontal row with dividers, light gray background `#FAFAF9`
- **Sidebar** — fixed left, white background, organized in named sections ("Menu", navigation groups), collapsible sections with chevron
- **Content card** — single white card containing the main table/content, with rounded corners, sitting on the stone-50 page background
- The overall look is: **white cards floating on a warm gray canvas**, with rose accent for active states and teal/orange for status badges

### Spacing Scale

- `4px` — tight (badge padding, inline gaps)
- `8px` — compact (button padding, small gaps)
- `12px` — default (sidebar item padding, input padding)
- `16px` — comfortable (card gaps, section gaps)
- `24px` — roomy (card internal padding, page margins)
- `32px` — spacious (section separations)
- `48px` — page-level (top padding on main content)

---

## Backend API Reference

All endpoints are prefixed with `http://localhost:3000/api/v1`. All responses are wrapped in `{ data: ... }` or `{ data: [...], meta: { page, limit, total, totalPages } }` for paginated responses. Errors return `{ statusCode, message, errors? }`.

### Auth

```
POST /auth/send-otp
  Body: { email: string }
  Response: { data: { message: "Verification code sent to your email" } }

POST /auth/verify-otp
  Body: { email: string, code: string }
  Response: { data: { accessToken: string, refreshToken: string } }

POST /auth/refresh
  Body: { refreshToken: string }
  Response: { data: { accessToken: string, refreshToken: string } }

POST /auth/logout
  Headers: Authorization: Bearer <accessToken>
  Body: { refreshToken: string }
  Response: { data: { message: "Logged out successfully" } }
```

### Users

```
GET /users/me
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { id, email, firstName, lastName, role, organizationId, organization: { id, name, industry: { id, name } } } }

PATCH /users/me
  Headers: Authorization: Bearer <accessToken>
  Body: { firstName?: string, lastName?: string }
  Response: { data: { ...updatedUser } }
```

### Organizations

```
POST /organizations
  Headers: Authorization: Bearer <accessToken>
  Body: { name: string, industryId: string, size?: string }
  Response: { data: { id, name, industryId, size, industry: { id, name } } }

GET /organizations/:id
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { id, name, industryId, size, industry: { id, name } } }

PATCH /organizations/:id
  Headers: Authorization: Bearer <accessToken>
  Body: { name?: string, size?: string }
  Response: { data: { ...updatedOrg } }

GET /organizations/:id/members?page=1&limit=20
  Headers: Authorization: Bearer <accessToken>
  Response: { data: [...members], meta: { page, limit, total, totalPages } }
```

### Industries

```
GET /industries?search=health&page=1&limit=20
  Response: { data: [...industries], meta: { page, limit, total, totalPages } }
  Each industry: { id, name, normalizedKey, aliases, createdAt }

GET /industries/:id
  Response: { data: { id, name, normalizedKey, aliases, createdAt } }
```

### Consultation Templates

```
GET /consultation/templates?page=1&limit=20
  Headers: Authorization: Bearer <accessToken>
  Response: { data: [...templates], meta }
  Each template: { id, type, status, version, industryId, industry, _count: { questions } }

GET /consultation/templates/:id
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { id, type, status, version, industry, questions: [...] } }

POST /consultation/templates/:id/regenerate
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { ...newTemplate } }
```

### Consultation Sessions

```
POST /consultation/sessions
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { id, status, organizationId, userId, questions: [...], organization: { industry } } }
  Status is either "IN_PROGRESS" or "PENDING_TEMPLATE"

GET /consultation/sessions?page=1&limit=20
  Headers: Authorization: Bearer <accessToken>
  Response: { data: [...sessions], meta }
  Each session: { id, status, startedAt, completedAt, user: { id, email, firstName, lastName }, _count: { questions } }

GET /consultation/sessions/:id
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { id, status, questions: [{ id, section, orderIndex, answer, answeredAt, skipped, question: { id, questionText, questionType, options } }], organization: { industry } } }

GET /consultation/sessions/:id/current-question
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { status, question: { id, section, orderIndex, question: { id, questionText, questionType, options } }, progress: { answered, total } } }
  If all answered: { data: { status: "COMPLETED", question: null } }

POST /consultation/sessions/:id/answers
  Headers: Authorization: Bearer <accessToken>
  Body: { questionId: string, value: string | string[] | number }
  Response: { data: { status: "IN_PROGRESS", nextQuestion: { ... } } }
  Or: { data: { status: "COMPLETED", nextQuestion: null } }

PATCH /consultation/sessions/:id/abandon
  Headers: Authorization: Bearer <accessToken>
  Response: { data: { ...updatedSession } }
```

### Health

```
GET /health
  Response: { data: { status: "ok", db: "connected", redis: "connected" } }
```

---

## API Client Setup

Create a centralized API client at `src/lib/api.ts`:

- Use `fetch` or `axios`
- Base URL from env: `NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1`
- Attach `Authorization: Bearer <token>` header from Zustand store on every authenticated request
- On 401 response: attempt token refresh using the stored `refreshToken`. If refresh fails, clear auth state and redirect to `/login`
- Unwrap the `{ data }` envelope — hooks should receive the inner `data` directly

---

## Auth Store (Zustand)

```typescript
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}
```

- Persist tokens to `localStorage`
- On app load, if tokens exist in localStorage, fetch `/users/me` to hydrate user state
- If `/users/me` fails (401), clear tokens and redirect to login

---

## Pages & Routes

### Public Routes

#### `/` — Landing Page (Full Marketing Page)

This is the first thing anyone sees. It must look like a polished, premium AI SaaS product — think Ailab, Linear, or Vercel marketing pages. No placeholder text — use real copy that matches the Taurus vision. Fully static (no API calls). This page should make someone think "this is a serious, funded product."

**Global Landing Page Setup:**
- Install `lenis` for smooth scrolling: `npm install lenis`. Initialize in the landing layout so the entire page has buttery smooth scroll behavior.
- All sections should animate into view on scroll using CSS `@keyframes` with `IntersectionObserver` (or a lightweight lib like `framer-motion`). Elements fade up + slide in (translateY 30px → 0, opacity 0 → 1, 600ms ease-out, staggered 100ms per element within each section).
- Maximum content width: `1200px`, centered with `auto` margins
- Sections alternate between `#FFFFFF` and `#F5F5F4` backgrounds for visual rhythm
- Generous vertical padding on every section: `100px` top and bottom (desktop), `64px` on mobile

**Navigation Bar (sticky)**
- Sticky top, white background with `backdrop-blur-md` and `bg-white/80` when scrolled, transparent when at top
- Left: `"Taurus"` wordmark — 20px, weight 700, `#1C1917`
- Center: nav links — `"Home"`, `"Features"`, `"Process"`, `"Pricing"` — 14px, weight 500, `#78716C`, hover `#1C1917`. These smooth-scroll to their respective sections.
- Right: two buttons:
  - `"Login"` — ghost/text button, `#1C1917`, 14px, weight 500, with subtle rounded border
  - `"Start for free →"` — pill button (full border-radius `9999px`), `#1C1917` bg, white text, 14px, weight 500, right arrow
- Height: `64px`, horizontal padding `24px`
- Subtle bottom border (`#E7E5E4`) appears when scrolled

**Section 1: Hero**
- Full-width, generous vertical padding (`140px` top, `100px` bottom)
- Eyebrow text: `"AI TRANSFORMATION OPERATING SYSTEM"` — 12px, uppercase, letter-spacing `4px`, `#78716C`, weight 600
- Main headline: `"Design Your AI Transformation with Precision."` — **56px** (desktop) / **36px** (mobile), weight 700, `#1C1917`, max-width `800px`, centered, line-height `1.1`
- Subtitle: `"Streamline your transformation journey and eliminate guesswork with intelligent AI consultation. Let our platform help you discover, strategize, and implement faster with unmatched precision."` — 17px, weight 400, `#78716C`, max-width `600px`, centered, line-height `1.6`
- Two CTA buttons side by side, centered, gap `16px`:
  - Primary: `"Start for free →"` — **pill-shaped** (`border-radius: 9999px`), `#1C1917` bg, `#FFFFFF` text, `48px` height, `32px` horizontal padding, weight 500, hover lift effect
  - Secondary: `"Contact Us"` — **pill-shaped**, white bg, `#1C1917` text, `1px` border `#E7E5E4`, `48px` height, hover bg `#F5F5F4`
- Below the buttons (40px gap): a **hero product mockup**
  - A stylized browser chrome frame (rounded `16px`, subtle shadow `0 8px 32px rgba(0,0,0,0.08)`, border `1px solid #E7E5E4`)
  - Inside: a mock of the Taurus consultation UI. Build this as a static component showing:
    - Left sidebar: list of conversation items (styled like a chat/task list) — e.g., `"Organization AI assessment"`, `"Industry analysis report"`, `"Roadmap generation"`, `"Implementation tracking"` — small text, grouped by `"Today"` and `"Previous 7 Days"` headers
    - Center: large heading `"Generate AI Transformation Insights"` with subtitle `"Create, analyze, and implement with intelligent AI"`, an input bar below styled like a prompt field (`"Ask me anything..."` placeholder), and at the bottom 3 pill-shaped link chips: `"AI Assessment →"`, `"Strategy Workshop →"`, `"Transformation Roadmap →"`
    - Top-right: a floating card showing model selector (`"Taurus AI"` with a checkmark, version badge)
  - This mockup gives visitors a preview of the actual product. It should look polished and realistic.
  - The mockup fades and slides up on page load (800ms delay, 600ms animation)

**Section 2: Social Proof / Logo Bar**
- Minimal padding (`48px` vertical)
- White background, no border
- Centered text: `"Trusted by forward-thinking organizations"` — 13px, `#A8A29E`, weight 400
- Row of 5-6 placeholder brand names rendered as styled text (simulating logos):
  - Use brand-style typography: `"Accenture"`, `"Deloitte"`, `"KPMG"`, `"McKinsey"`, `"EY"`, `"BCG"`
  - Each: 18px, weight 600, `#A8A29E` color (grayed out), horizontal spacing `48px` between them
  - Row is horizontally centered, wraps on mobile
- Subtle top and bottom dividers (`#E7E5E4`, `0.5px`)

**Section 3: Features — Tab-Based Showcase**
- Background: `#F5F5F4`
- Section heading: `"Powerful Features Built for Transformation"` — 40px, weight 700, centered, `#1C1917`
- Subtitle: `"From assessment to analytics, our AI platform helps you simplify complex transformation workflows and accelerate business growth."` — 16px, `#78716C`, centered, max-width `600px`
- **Horizontal tab row** below the subtitle (centered):
  - Tab pills: `"AI Assessment"`, `"Industry Analysis"`, `"Roadmap Generation"`, `"Implementation"`, `"Progress Tracking"`, `"Team Management"`
  - Each tab: pill-shaped (`border-radius: 9999px`), `14px`, weight 500, padding `10px 20px`
  - Inactive: white bg, `#1C1917` text, `1px` border `#E7E5E4`
  - Active: `#1C1917` bg, `#FFFFFF` text
  - Tabs switch the content below with a crossfade animation (300ms)
- **Tab content area** (below tabs, `48px` gap):
  - Layout: left side = text content, right side = mockup visual
  - Left side (40% width):
    - Tab title as heading: e.g., `"AI Assessment"` — 28px, weight 700
    - Description: e.g., `"Boost efficiency and map your organization's AI readiness with intelligent tools designed to identify gaps, score maturity, and help teams focus on what truly matters."` — 15px, `#78716C`, line-height 1.7
  - Right side (60% width):
    - A decorative rounded card (`16px` radius, subtle border, white bg) containing a simple abstract line illustration or a stylized chart/dashboard mockup built with CSS (e.g., a line chart with dots, or a simple bar chart, or a kanban-style layout)
    - Different visual for each tab — use CSS-only decorative UI elements (progress bars, stat cards, simple charts made with divs)
  - On mobile: stack vertically (text on top, visual below)
- **Below the tab area**: 2x2 grid of feature highlight cards:
  - Card 1: `"Data Driven Insights"` — `"Turn consultation answers into actionable intelligence. Identify opportunities and predict ROI with AI-powered analytics."` — Icon: BarChart3
  - Card 2: `"Smart Notifications"` — `"Stay informed without the noise. Get personalized alerts for critical updates, deadlines, and transformation milestones."` — Icon: Bell
  - Card 3: `"Automated Task Management"` — `"Eliminate repetitive work with intelligent automation. Our AI prioritizes actions so your team can focus on meaningful work."` — Icon: Zap
  - Card 4: `"Team Collaboration Hub"` — `"Connect your team in a single workspace. Share insights, assign tasks, and track progress seamlessly."` — Icon: Users
  - Each card: white bg, `16px` radius, `1px` border `#E7E5E4`, `32px` padding, icon at top (in a `48px` circle with `#F5F5F4` bg), title `18px` weight 600, description `14px` `#78716C`
  - Cards should have a subtle inner mockup/screenshot area at the top (a `200px` height rounded area with `#F5F5F4` bg and a simple CSS-drawn UI element inside — e.g., a chart, a notification list, a task list, a calendar grid)

**Section 4: Our Process — Vertical Tab Layout**
- Background: `#FFFFFF`
- Section heading: `"Our Process"` — 40px, weight 700, left-aligned (NOT centered — editorial feel)
- Subtitle: `"From onboarding to optimization, we make sure every step of your journey is seamless and supported by smart automation."` — 16px, `#78716C`, left-aligned, max-width `500px`
- **Two-column layout** (desktop):
  - Left column (30%): **Vertical tab list**
    - Four tabs stacked vertically: `"Discover"`, `"Strategize"`, `"Quantify"`, `"Transform"`
    - Each tab: `20px` font, weight 500, `#A8A29E` color, `16px` vertical padding
    - Active tab: `#1C1917` color, weight 700, with a `3px` left border in `#1C1917` (vertical line indicator)
    - Tabs are clickable — switching changes the right content with a crossfade
  - Right column (70%): **Tab content**
    - Pill badge at top: current tab name (e.g., `"Discover"`) — pill-shaped, `#1C1917` text, `1px` border, small (12px font)
    - Heading: varies per tab:
      - Discover: `"Understand Your Needs"` — `"We start by understanding your goals and identifying key areas where AI can bring the most impact to your operations."`
      - Strategize: `"Build Your Strategy"` — `"Complete an AI-powered consultation with industry-specific questions tailored to your exact context."`
      - Quantify: `"Measure the Value"` — `"Every recommendation comes with dollar values, effort estimates, and ROI projections you can take to the board."`
      - Transform: `"Implement & Track"` — `"Turn insights into action with a phased roadmap, progress tracking, and automated status updates."`
    - Heading: `32px`, weight 700, `#1C1917`
    - Description: `16px`, `#78716C`, max-width `480px`
    - Below the text (`32px` gap): a **visual area** — a rounded card (`16px` radius, shadow-sm) containing a stylized mockup:
      - Discover tab: a mock chat interface showing user question and AI response (like the Ailab inspiration)
      - Strategize tab: a mock questionnaire interface with radio buttons and progress bar
      - Quantify tab: a mock report card showing "Score: 58/100" with a bar chart
      - Transform tab: a mock kanban board with 3 columns
      - Build these as simple CSS components, not images
  - On mobile: collapse to accordion-style — tab name as header, content below

**Section 5: Pricing**
- Background: `#F5F5F4`
- Section heading: `"Pricing Plans"` — 40px, weight 700, centered
- Subtitle: `"Start with a free trial to explore the power of AI, then scale up as your business grows."` — 16px, `#78716C`, centered
- **Two pricing cards** side by side (equal width), plus one featured card below:
  - **Starter Plan** (white card, `16px` radius, border, `40px` padding):
    - Title: `"Starter Plan"` — 20px, weight 700
    - Description: `"Get started with essential AI tools for your transformation workflow."` — 14px, `#78716C`
    - Price: `"$499"` — 48px, weight 700, `#1C1917` + `"/mo"` in 16px, `#78716C`
    - CTA: `"Get Started →"` — pill button, `#1C1917` bg, white text
    - Testimonial inline (small): avatar circle (gray placeholder, `32px`), name `"Sarah M., CTO"` 12px weight 600, quote `"Simple and fast to set up. Recommended!"` 12px italic `#78716C`
    - Divider
    - `"Includes:"` label, then a 2-column list of features with checkmark icons (CircleCheck, `#0D9488`):
      - `"Up to 3 team members"`, `"AI maturity assessment"`, `"Industry-specific questions"`, `"Basic transformation roadmap"`, `"Email support"`, `"Quarterly re-assessment"`
  - **Enterprise Plan** (white card, same style):
    - Title: `"Enterprise Plan"` — 20px, weight 700
    - Description: `"Scale your business with full capabilities and white-label options."` — 14px, `#78716C`
    - Price: `"$9,999"` + `"/mo"`
    - Same structure: CTA, testimonial, feature list:
      - `"Unlimited team members"`, `"Custom AI models"`, `"White-label ready"`, `"Dedicated success manager"`, `"API access"`, `"24/7 priority support"`, `"Advanced analytics"`, `"Custom integrations"`
  - **Professional Plan** (FEATURED — **dark card**, `#1C1917` bg, white text, slightly larger, `16px` radius, spans full width below the two cards):
    - Left side: title `"Professional Plan"`, description, price `"$2,499"` + `"/mo"`, CTA pill button (white bg, dark text), inline testimonial
    - Right side: feature list in 2 columns, checkmark icons in `#0D9488`
    - Features: `"Everything in Starter"`, `"Up to 25 team members"`, `"Full transformation roadmap"`, `"Implementation tracking"`, `"Department-level analysis"`, `"Monthly re-assessment"`, `"Priority email & chat support"`, `"Board-ready reports"`
  - On mobile: all three cards stack vertically

**Section 6: Testimonials**
- Background: `#FFFFFF`
- Section heading: `"What Our Clients Say"` — 40px, weight 700, centered
- Subtitle: `"Real experiences from businesses that integrated our AI into their transformation workflow."` — 16px, `#78716C`, centered, max-width `560px`
- **Avatar cluster** centered: 3-4 overlapping circular avatar placeholders (gray circles with initials, `56px` each, overlapping by `16px`, subtle border `3px solid white`)
- **Single large testimonial card** below (centered, max-width `700px`):
  - White bg, `16px` radius, `1px` border, `48px` padding
  - Quote text: `"Our transformation journey finally has structure — initiatives are tracked, ROI is measured, and decisions are faster than ever."` — 22px, weight 600, `#1C1917`, line-height 1.5
  - Below: smaller detail text — `"The AI insights helped us identify $1.2M in efficiency gains and cut our assessment time from 6 weeks to 2 days."` — 15px, `#78716C`
  - Bottom row: name `"Michael R."` weight 600, `14px` + star icon (Star, filled, `#F59E0B`) + `"4.9"`, and role `"VP of Operations, Delta Solutions"` 13px `#78716C`
  - Decorative: large quotation mark `"` icon (120px, `#E7E5E4`, opacity 30%) positioned bottom-right of the card, partially overflowing

**Section 7: CTA Banner**
- Full-width section
- Inside: a large rounded card (`24px` radius, max-width `1200px`, centered) with a **subtle gradient background**: `linear-gradient(135deg, #F5F5F4 0%, #E7E5E4 50%, #D6D3D1 100%)` — warm, muted, sophisticated (NO bright colors)
- Content centered inside the card, `80px` vertical padding:
  - Heading: `"Ready to Transform the Way You Work?"` — 40px, weight 700, `#1C1917`
  - Subtitle: `"Experience how AI can automate your assessments, quantify your opportunities, and accelerate decision making, all in one powerful platform."` — 16px, `#78716C`, max-width `560px`
  - Two CTA buttons (pill-shaped, centered):
    - `"Start for free →"` — white bg, dark text, shadow-sm
    - `"Contact Us"` — outline, dark text, border `#78716C`

**Section 8: Footer**
- White background, generous padding (`64px` top, `48px` bottom)
- **Top row**: left = `"Taurus"` wordmark (20px, weight 700), right = social media icons row (4 circle buttons, `40px` each, `1px` border `#E7E5E4`, Lucide icons: Twitter/X, Linkedin, Github, Mail — `#1C1917`)
- Subtle divider (`#E7E5E4`)
- **Main footer content** (4-column layout):
  - Column 1: `"Subscribe to our newsletter"` heading (14px, weight 600), then an inline email input + button:
    - Input: pill-shaped, `#F5F5F4` bg, placeholder `"Enter your email"`, mail icon left
    - Button inside input: `"Get Early Access"` pill, `#1C1917` bg, white text (the input and button are one combined component, like a search bar with embedded button)
  - Column 2: `"Product"` — links: `"Features"`, `"Pricing"`, `"Documentation"`, `"Changelog"`
  - Column 3: `"Company"` — links: `"About"`, `"Blog"`, `"Careers"`, `"Contact"`
  - Column 4: `"Legal"` — links: `"Privacy Policy"`, `"Terms of Service"`, `"Cookie Policy"`
  - Links: 14px, weight 400, `#78716C`, hover `#1C1917`
  - Column headings: 14px, weight 600, `#1C1917`
- **Large decorative watermark**: the word `"TAURUS"` rendered huge (200px+, weight 800, `#F5F5F4` color — barely visible against white bg) at the bottom of the footer, centered, overflowing and clipped. This creates the premium editorial feel from the Ailab design.
- Bottom bar: `"© 2026 MARQAIT AI. All rights reserved."` left, `"Terms of Service · Privacy Policy"` right — both 12px, `#A8A29E`
- On mobile: columns stack, watermark hidden

**Landing Page Design Notes:**
- The entire page MUST feel like a premium AI SaaS product (think Linear, Notion, Vercel, Ailab)
- Install and use **Lenis** for smooth scrolling across the entire landing page
- All sections animate on scroll — elements fade up with `translateY(30px)` → `0` and `opacity: 0` → `1`. Use `IntersectionObserver` or `framer-motion` with `whileInView`
- Stagger child animations within each section (100ms delay per element)
- Hero mockup has a subtle floating animation (translateY 0 → -8px → 0, 4s infinite, ease-in-out)
- Tab switching in Features and Process sections uses crossfade (opacity transition, 300ms)
- Sticky nav transitions from transparent → white with blur on scroll (use scroll listener)
- Buttons have hover micro-interactions: primary buttons lift (`translateY(-2px)`, `shadow-md`), secondary buttons darken border
- Use generous vertical spacing between sections (100-120px on desktop)
- Responsive: all grids collapse to single column on mobile, process section becomes accordion
- Use Lucide icons throughout
- NO stock photos or external images. All visuals are CSS-built mockup components (browser frames, chat UIs, charts, kanban boards). The design should be confident enough to stand with pure typography, layout, and CSS illustrations.

#### `/login` — Authentication
- Single page handling both OTP send and verify
- **Step 1**: Email input + "Send Code" button
  - Calls `POST /auth/send-otp`
  - On success, transition to Step 2
- **Step 2**: 6-digit code input + "Verify" button
  - Show the email the code was sent to, with "Change email" link to go back
  - 6 individual digit inputs (auto-advance on type, backspace support)
  - Calls `POST /auth/verify-otp`
  - On success: store tokens, fetch `/users/me`, redirect based on user state:
    - If user has no `organizationId` → redirect to `/onboarding`
    - If user has org → redirect to `/dashboard`
- "Resend code" link with 60-second cooldown timer

### Authenticated Routes (require auth, redirect to `/login` if not)

#### `/onboarding` — New User Setup (multi-step)

Only shown if user has no `organizationId`. If they already have an org, redirect to `/dashboard`.

**Step 1: Complete Profile**
- firstName, lastName inputs
- Calls `PATCH /users/me`
- "Continue" button

**Step 2: Create Organization**
- Organization name input
- Industry selector:
  - Searchable dropdown/combobox
  - Fetches `GET /industries?search=<query>` on type
  - Shows industry name, user picks one
- Company size selector (dropdown): "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"
- Calls `POST /organizations`
- On success → redirect to `/dashboard`

#### `/dashboard` — Main Dashboard

The home page for authenticated users. Shows:

- **Welcome section**: "Welcome back, {firstName}" with org name and industry
- **Quick actions card**: "Start New Consultation" button (calls `POST /consultation/sessions`, redirects to `/consultation/:id`)
- **Past sessions list**: Fetches `GET /consultation/sessions`
  - Table or card list showing: start date, status badge (IN_PROGRESS / COMPLETED / ABANDONED / PENDING_TEMPLATE), question count
  - Click on a session → navigates to `/consultation/:id`
  - Status badges: IN_PROGRESS = dark outline, COMPLETED = success green, ABANDONED = muted gray, PENDING_TEMPLATE = pulsing/loading
- **Organization info card**: Name, industry, member count (from `GET /organizations/:id/members`)

#### `/consultation/:id` — Consultation Session

This is the core experience. Handles all session states:

**If `status === "PENDING_TEMPLATE"`:**
- Show a waiting screen: "We're generating industry-specific questions for your consultation. This usually takes less than a minute."
- Animated loading indicator
- Poll `GET /consultation/sessions/:id` every 5 seconds until status changes to `IN_PROGRESS`
- When ready, transition smoothly into the question flow

**If `status === "IN_PROGRESS"`:**
- Full-screen, focused question flow (no sidebar distractions)
- Top: progress bar showing `answered / total` questions
- Top: section indicator showing "BASE QUESTIONS" or "INDUSTRY QUESTIONS"
- Center: the current question, large and readable
- Below the question: the answer input, rendered by question type:

  **TEXT**: Multi-line textarea with character count
  **SINGLE_CHOICE**: Radio button group, vertically stacked, one selection
  **MULTI_CHOICE**: Checkbox group, vertically stacked, multiple selections
  **SCALE**: Horizontal 1-5 selector with labels ("1 — Not at all" to "5 — Fully mature")

- "Submit Answer" button — calls `POST /consultation/sessions/:id/answers` with `{ questionId, value }`
  - For TEXT: value is the string
  - For SINGLE_CHOICE: value is the selected option string
  - For MULTI_CHOICE: value is array of selected option strings
  - For SCALE: value is the number (1-5)
- On submit: animate transition to the next question from the response
- "Skip" option (optional, less prominent) — submits with skipped flag if needed
- Keyboard support: Enter to submit for text, arrow keys for scale

**If `status === "COMPLETED"`:**
- Completion screen: "Consultation Complete"
- Summary: total questions answered, time taken (from startedAt to completedAt)
- "Your AI transformation report is being generated..." placeholder message (Phase 2)
- "Back to Dashboard" button

**If `status === "ABANDONED"`:**
- Show abandoned state with option to start a new consultation

#### `/consultation/:id/review` — Review Completed Session

- Full read-only view of all questions and answers
- Fetch `GET /consultation/sessions/:id`
- Group questions by section (BASE, INDUSTRY)
- Show each question with the submitted answer
- For SCALE answers, show visual indicator (filled dots or bar)
- For MULTI_CHOICE, show selected options highlighted

#### `/settings` — Settings Page

Two tabs: **Profile** and **Organization**

**Profile tab:**
- Shows email (read-only), firstName, lastName (editable)
- "Save Changes" button → `PATCH /users/me`

**Organization tab (Admin only):**
- Shows org name (editable), industry (read-only), size (editable)
- "Save Changes" button → `PATCH /organizations/:id`
- Members list: `GET /organizations/:id/members`
  - Table: name, email, role badge (ADMIN/MEMBER), joined date

#### `/admin/templates` — Template Management (Admin only)

- List all templates: `GET /consultation/templates`
- Table: type (BASE/INDUSTRY), industry name, status badge, version, question count
- Click to expand/view template details: `GET /consultation/templates/:id`
  - Shows all questions in order
- "Regenerate" button on INDUSTRY templates → `POST /consultation/templates/:id/regenerate`
  - Confirm dialog: "This will generate a new version of questions for this industry. Existing sessions won't be affected."

---

## Layout Structure

### Public Layout (`/`, `/login`)
- Minimal: centered content, max-width 480px for login, full-width for landing
- No sidebar, no header navigation
- Small "Taurus" wordmark top-left

### Authenticated Layout (`/dashboard`, `/consultation/*`, `/settings`, `/admin/*`)
- **Sidebar** (left, 256px, collapsible):
  - "Taurus" wordmark at top
  - Navigation links with Lucide icons:
    - Dashboard (LayoutDashboard icon)
    - Consultations (ClipboardList icon) — links to dashboard sessions section
    - Settings (Settings icon)
    - Templates (FileText icon) — only visible for ADMIN role
  - Divider
  - User info at bottom: name, email, "Log out" button
- **Main content**: right of sidebar, with top padding

### Consultation Layout (`/consultation/:id`)
- **No sidebar** — full-screen, distraction-free
- Minimal header: "Taurus" wordmark left, "Exit" button right (→ abandon confirmation dialog → dashboard)
- Content centered, max-width 640px

---

## Component Inventory

Use **shadcn/ui** for all of these. Install and configure shadcn first.

### Required shadcn components:
- Button
- Input
- Textarea
- Label
- Card (CardHeader, CardTitle, CardDescription, CardContent)
- Badge
- Dialog (for confirmations)
- DropdownMenu
- Select
- Command (for searchable industry combobox)
- Popover (used with Command for combobox)
- Table (TableHeader, TableBody, TableRow, TableCell)
- Tabs (for settings page)
- Progress (for consultation progress bar)
- Skeleton (for loading states)
- Toast (via Sonner — for success/error notifications)
- RadioGroup
- Checkbox
- Separator

### Custom components to build:

- `QuestionRenderer` — renders the correct input based on `questionType` (TEXT → Textarea, SINGLE_CHOICE → RadioGroup, MULTI_CHOICE → Checkboxes, SCALE → custom 1-5 selector)
- `StatusBadge` — renders session status with appropriate styling
- `IndustryCombobox` — searchable industry selector using Command + Popover
- `OtpInput` — 6-digit code input with auto-advance
- `ProtectedRoute` — wrapper that checks auth state, redirects if needed
- `SectionIndicator` — shows BASE / INDUSTRY section label during consultation

---

## Data Fetching Patterns (TanStack Query)

### Query Keys Convention
```
['user', 'me']
['industries', { search, page }]
['organization', orgId]
['organization', orgId, 'members', { page }]
['sessions', { page }]
['session', sessionId]
['session', sessionId, 'current-question']
['templates', { page }]
['template', templateId]
```

### Key Hooks to Create

```typescript
// Auth
useSendOtp()           // mutation
useVerifyOtp()         // mutation
useRefreshToken()      // mutation
useLogout()            // mutation

// User
useMe()                // query — GET /users/me
useUpdateMe()          // mutation — PATCH /users/me

// Organizations
useCreateOrg()         // mutation — POST /organizations
useOrganization(id)    // query — GET /organizations/:id
useUpdateOrg(id)       // mutation — PATCH /organizations/:id
useOrgMembers(id, page) // query — GET /organizations/:id/members

// Industries
useIndustries(search, page)  // query — GET /industries
useIndustry(id)              // query — GET /industries/:id

// Sessions
useSessions(page)             // query — GET /consultation/sessions
useSession(id)                // query — GET /consultation/sessions/:id
useCurrentQuestion(id)        // query — GET /consultation/sessions/:id/current-question
useStartSession()             // mutation — POST /consultation/sessions
useSubmitAnswer(sessionId)    // mutation — POST /consultation/sessions/:id/answers
useAbandonSession(sessionId)  // mutation — PATCH /consultation/sessions/:id/abandon

// Templates (admin)
useTemplates(page)            // query — GET /consultation/templates
useTemplate(id)               // query — GET /consultation/templates/:id
useRegenerateTemplate(id)     // mutation — POST /consultation/templates/:id/regenerate
```

### Important Query Behaviors

- `useCurrentQuestion` should have `refetchInterval: 5000` only when session status is `PENDING_TEMPLATE`
- After `useSubmitAnswer` succeeds, invalidate `['session', sessionId, 'current-question']`
- After `useStartSession` succeeds, navigate to `/consultation/:id`
- After `useCreateOrg` succeeds, invalidate `['user', 'me']` (user now has organizationId)
- `useMe` should be enabled only when `isAuthenticated` is true

---

## Error Handling

- All API errors return `{ statusCode, message, errors? }`
- Show toast notifications for errors using Sonner
- 401 errors: trigger token refresh. If refresh fails, redirect to `/login` with toast "Session expired"
- 403 errors: show "You don't have permission" toast
- 409 errors: show "Already exists" toast
- 429 errors: show "Too many requests, please wait" toast
- Network errors: show "Connection error, please try again" toast

---

## Loading States

- Use shadcn Skeleton components for page-level loading
- Use button loading state (disabled + spinner) for form submissions
- Dashboard: skeleton cards while sessions load
- Consultation: skeleton for question while submitting answer
- Never show blank pages — always show either content or skeleton

---

## Responsive Design

- Sidebar collapses to hamburger on mobile (< 768px)
- Consultation flow is already centered and works on mobile
- Dashboard cards stack vertically on mobile
- Tables become card-based lists on mobile
- Minimum supported width: 375px (iPhone SE)

---

## Additional Dependencies

```bash
npm install lenis                     # Smooth scrolling for landing page
npm install framer-motion             # Scroll-triggered animations and page transitions
npm install sonner                    # Toast notifications
```

---

## Environment Variables

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
```

---

## File Structure

```
taurus-frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout (Inter font, providers)
│   │   ├── page.tsx                      # Landing page
│   │   ├── login/
│   │   │   └── page.tsx                  # OTP login
│   │   ├── onboarding/
│   │   │   └── page.tsx                  # Profile + org setup
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                # Sidebar layout
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx              # Main dashboard
│   │   │   ├── settings/
│   │   │   │   └── page.tsx              # Profile & org settings
│   │   │   └── admin/
│   │   │       └── templates/
│   │   │           └── page.tsx          # Template management
│   │   └── consultation/
│   │       └── [id]/
│   │           ├── layout.tsx            # Distraction-free layout
│   │           ├── page.tsx              # Question flow
│   │           └── review/
│   │               └── page.tsx          # Completed session review
│   ├── components/
│   │   ├── ui/                           # shadcn components
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   └── auth-layout.tsx
│   │   ├── auth/
│   │   │   └── otp-input.tsx
│   │   ├── consultation/
│   │   │   ├── question-renderer.tsx
│   │   │   ├── section-indicator.tsx
│   │   │   ├── progress-header.tsx
│   │   │   └── status-badge.tsx
│   │   ├── onboarding/
│   │   │   └── industry-combobox.tsx
│   │   └── shared/
│   │       └── protected-route.tsx
│   ├── hooks/
│   │   ├── use-auth.ts                   # Auth mutations
│   │   ├── use-user.ts                   # User queries/mutations
│   │   ├── use-organizations.ts          # Org queries/mutations
│   │   ├── use-industries.ts             # Industry queries
│   │   ├── use-sessions.ts               # Session queries/mutations
│   │   └── use-templates.ts              # Template queries/mutations (admin)
│   ├── lib/
│   │   ├── api.ts                        # API client with auth interceptor
│   │   ├── utils.ts                      # cn() helper from shadcn
│   │   └── constants.ts                  # Size options, status labels, etc.
│   ├── stores/
│   │   └── auth-store.ts                 # Zustand auth store
│   └── types/
│       └── index.ts                      # All TypeScript types matching API responses
├── public/
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
└── .env.local
```

---

## Types (matching backend API responses)

```typescript
// User
interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'ADMIN' | 'MEMBER';
  organizationId: string | null;
  organization: Organization | null;
  createdAt: string;
  updatedAt: string;
}

// Organization
interface Organization {
  id: string;
  name: string;
  industryId: string;
  size: string | null;
  industry: Industry;
  createdAt: string;
  updatedAt: string;
}

// Industry
interface Industry {
  id: string;
  name: string;
  normalizedKey: string;
  aliases: string[];
  createdAt: string;
}

// Templates
interface ConsultationTemplate {
  id: string;
  type: 'BASE' | 'INDUSTRY';
  status: 'GENERATING' | 'ACTIVE' | 'DEPRECATED';
  version: number;
  industryId: string | null;
  industry: Industry | null;
  questions?: TemplateQuestion[];
  _count?: { questions: number };
  createdAt: string;
}

interface TemplateQuestion {
  id: string;
  templateId: string;
  questionText: string;
  questionType: 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
  options: string[] | null;
  orderIndex: number;
  isRequired: boolean;
  metadata: unknown;
}

// Sessions
interface ConsultationSession {
  id: string;
  organizationId: string;
  userId: string;
  status: 'PENDING_TEMPLATE' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  startedAt: string;
  completedAt: string | null;
  questions: SessionQuestion[];
  organization: Organization;
  user?: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>;
  _count?: { questions: number };
}

interface SessionQuestion {
  id: string;
  sessionId: string;
  questionId: string;
  section: 'BASE' | 'INDUSTRY' | 'CHALLENGE_BONUS';
  orderIndex: number;
  answer: { value: string | string[] | number } | null;
  answeredAt: string | null;
  skipped: boolean;
  question: TemplateQuestion;
}

interface CurrentQuestionResponse {
  status: string;
  question: SessionQuestion | null;
  progress: { answered: number; total: number };
}

interface SubmitAnswerResponse {
  status: 'IN_PROGRESS' | 'COMPLETED';
  nextQuestion: SessionQuestion | null;
}

// Pagination
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API envelope
interface ApiResponse<T> {
  data: T;
}
```

---

## Implementation Order

Build in this exact order to have something working at each step:

1. **Project setup**: `npx create-next-app@latest taurus-frontend --typescript --tailwind --app --src-dir`. Install dependencies. Configure shadcn. Set up Plus Jakarta Sans font. Create the API client and auth store.

2. **Landing page + Login**: Build `/` and `/login` with OTP flow. Test that authentication works end-to-end. Tokens stored in localStorage and Zustand.

3. **Protected route + Layout**: Build the authenticated layout with sidebar. Build the ProtectedRoute wrapper. Test redirect logic (no auth → login, no org → onboarding).

4. **Onboarding**: Build `/onboarding` with profile completion and org creation. Industry combobox with search. Test full flow: login → onboarding → dashboard.

5. **Dashboard**: Build `/dashboard` with welcome section, session list, quick actions. Test session listing and status badges.

6. **Consultation flow**: Build `/consultation/:id` with all question types, progress bar, section indicators. This is the most complex page. Test the full Q&A flow end-to-end.

7. **Session review**: Build `/consultation/:id/review` for completed sessions.

8. **Settings**: Build `/settings` with profile and org tabs.

9. **Admin templates**: Build `/admin/templates` for template management.

10. **Polish**: Loading states, error handling, responsive design, toast notifications, keyboard navigation.

---

## Design Cohesion — Landing → Onboarding → App

**CRITICAL**: The transition from marketing pages → onboarding → in-app experience must feel like ONE product, not three separate things stitched together. Every screen shares the same DNA.

### Shared Across All Surfaces
- Same font (Plus Jakarta Sans) everywhere — landing, auth, onboarding, dashboard
- Same color palette — `#1C1917` primary, `#78716C` secondary, `#E7E5E4` borders, `#F5F5F4` canvas
- Same border-radius language — `8px` buttons/inputs, `12-16px` cards, `9999px` pills/badges
- Same spacing scale — 8/12/16/24/32/48px
- Same button styles — primary dark pill, secondary outline pill
- Same shadow levels — Level 0 (border only), Level 1 (subtle), Level 2 (modals)

### Transition Points (must feel seamless)
- **Landing → Login**: The nav `"Login"` button goes to `/login`. The login page uses the same white + stone palette, same font, same button styles. The `"Taurus"` wordmark on the login page matches the nav wordmark exactly.
- **Login → Onboarding**: After OTP verify, the transition to onboarding should feel like the next step in a flow, not a different app. Use the same centered layout, same card styling, same input styling.
- **Onboarding → Dashboard**: The onboarding completion animation (checkmark + "You're all set!") transitions into the dashboard layout. The sidebar should feel like a natural extension of the clean aesthetic from the marketing site.
- **Dashboard → Consultation**: Entering the consultation flow removes the sidebar for focus, but keeps the same font, colors, and spacing. The question cards use the same card styling as the landing page feature cards.

### The Onboarding Flow Should Feel Premium
- The onboarding (`/onboarding`) is a multi-step flow. Style it like a premium wizard:
  - Centered card on `#F5F5F4` background (same canvas as landing page)
  - Step indicator at top (dots or numbered steps, subtle)
  - Smooth transitions between steps (slide-left animation, 300ms)
  - The industry combobox should feel as polished as any landing page element
  - "Continue" button uses the same dark pill style from the landing CTAs
- The login page should have the `"Taurus"` wordmark centered at top, and a centered card with the OTP flow inside. Understated, calm, confident.

---

## Visual Polish & AI SaaS Feel

This app must look like a polished, funded AI SaaS product — not a student project. These details matter:

### Animations & Transitions
- Page transitions: subtle fade-in on route change (150ms ease)
- Question transitions in consultation: slide-left animation (300ms) as the next question enters
- Sidebar nav: smooth background-color transition on hover (150ms)
- Button hover: subtle lift (`translateY(-1px)`) with transition
- Status badges: `PENDING_TEMPLATE` gets a subtle pulse animation (CSS keyframe)
- Skeleton loading: use shimmer animation, not static gray blocks
- Toast notifications: slide-in from top-right with Sonner
- Progress bar: animated width transition (500ms ease-out) as questions are answered
- Cards on dashboard: subtle fade-in stagger on initial load (each card 50ms delayed)

### Micro-Interactions
- OTP input boxes: scale up slightly (1.05) when focused, border color shifts to `#1C1917`
- "Submit Answer" button: shows a subtle checkmark animation briefly (200ms) before transitioning to next question
- Consultation completion: confetti-free but celebratory — large checkmark icon with a scale-in animation, then the completion stats fade in below
- Industry combobox: results fade-in smoothly as user types
- Hover on table rows: smooth background shift to `#FAFAF9`

### Empty States
- No sessions yet: illustration-free empty state with icon (ClipboardList, 48px, `#A8A29E`), heading "No consultations yet", description "Start your first AI transformation consultation to assess your organization's readiness.", CTA button "Start Consultation"
- No members: similar pattern with Users icon
- Every list/table must have a designed empty state — never show a blank area

### Overall Aesthetic Checklist
- [ ] Every page has clear visual hierarchy (one primary action, clear headings)
- [ ] Tables are clean with minimal borders (bottom border only, hover highlight)
- [ ] Status badges are pill-shaped, uppercase, small, bold
- [ ] Cards have consistent padding (24px), consistent radius (12px)
- [ ] The sidebar feels like part of a premium tool (think Linear, Notion)
- [ ] The consultation flow feels focused and calm (no distractions, no sidebar)
- [ ] The landing page would be credible if shown to a VC or enterprise client
- [ ] Loading states use skeleton shimmer, never blank screens
- [ ] The font (Plus Jakarta Sans) is consistently applied everywhere
- [ ] Color usage is restrained — warm grays dominate, accent colors are sparse and intentional

---

## Critical Implementation Details

### OTP Input Behavior
- 6 separate input boxes, each accepts 1 digit
- On paste: distribute digits across all 6 inputs
- Auto-advance cursor to next input on type
- Backspace: clear current input and move to previous
- Auto-submit when all 6 digits are entered

### Consultation Question Transition
- When submitting an answer, show brief loading state on the button
- On success, the API response contains `nextQuestion` — use this directly instead of refetching
- Animate the question transition (simple fade or slide)
- Progress bar updates smoothly

### Token Refresh Flow
- API client interceptor catches 401 responses
- Attempts `POST /auth/refresh` with stored refreshToken
- If refresh succeeds: retry the original request with new token
- If refresh fails: clear auth state, redirect to `/login`
- Prevent multiple simultaneous refresh attempts (use a promise lock)

### Session Polling for PENDING_TEMPLATE
- When a session is in PENDING_TEMPLATE state, the industry template is being generated by AI in the background
- Poll `GET /consultation/sessions/:id` every 5 seconds
- Show a loading animation with message: "Generating industry-specific questions..."
- When status changes to IN_PROGRESS, stop polling and start the question flow
- Typically resolves in 5-15 seconds

### Industry Combobox
- Debounce search input (300ms)
- Fetch `GET /industries?search=<query>` on each debounced change
- Show results in a dropdown
- If no search query, fetch all industries (first page)
- Display industry name, select stores industryId

### Admin-Only UI
- Check `user.role === 'ADMIN'` from auth store
- Hide "Templates" nav link for non-admins
- `/admin/*` routes should redirect non-admins to `/dashboard`
- Regenerate button should show confirmation dialog before proceeding
