import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ── Demo identity ─────────────────────────────────────────

const DEMO_EMAIL = 'sarah@acme.com';
const DEMO_OTP = '123456';
const DEMO_FIRST = 'Sarah';
const DEMO_LAST = 'Chen';
const ORG_NAME = 'Acme SaaS';

// Stable UUIDs so re-running the seed keeps the same recommendation IDs
// (the Tracker importer dedupes by sourceRecommendationId).
const REC_IDS = {
  ticketCat: '11111111-1111-1111-1111-111111111111',
  tier1Sugg: '22222222-2222-2222-2222-222222222222',
  churn:     '33333333-3333-3333-3333-333333333333',
  salesOut:  '44444444-4444-4444-4444-444444444444',
  docsRag:   '55555555-5555-5555-5555-555555555555',
  mtgNotes:  '66666666-6666-6666-6666-666666666666',
};

async function main() {
  console.log('Seeding demo account...');

  // 1. Find the SaaS industry (already seeded by prisma/seed.ts)
  const industry = await prisma.industry.findUnique({
    where: { normalizedKey: 'technology_saas' },
  });
  if (!industry) {
    throw new Error(
      'Industry "technology_saas" missing — run `npx prisma db seed` first to create base industries + template.',
    );
  }

  // 2. Upsert Sarah
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      firstName: DEMO_FIRST,
      lastName: DEMO_LAST,
      role: 'ADMIN',
      onboardingCompleted: true,
    },
    create: {
      email: DEMO_EMAIL,
      firstName: DEMO_FIRST,
      lastName: DEMO_LAST,
      role: 'ADMIN',
      onboardingCompleted: true,
    },
  });

  // 3. Upsert Organization (no @unique on name — look up manually)
  let org = await prisma.organization.findFirst({
    where: { name: ORG_NAME, industryId: industry.id },
  });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: ORG_NAME,
        industryId: industry.id,
        size: '100-500',
      },
    });
  }

  // 4. Link user → org
  await prisma.user.update({
    where: { id: user.id },
    data: { organizationId: org.id },
  });

  // 5. Onboarding (completed, no companyUrl so the scrape job doesn't fire)
  await prisma.onboarding.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      currentStep: 7,
      completed: true,
      companyName: ORG_NAME,
      industryId: industry.id,
      companySize: '100-500',
      businessDescription:
        'Customer engagement platform for mid-market SaaS — live chat, ticket routing, and in-app messaging. ~120 employees, 2,200 paying customers, $18M ARR.',
      revenueStreams:
        'Subscription tiers (Starter, Growth, Enterprise) + professional services revenue.',
      selectedChallenges: [
        'operational_efficiency',
        'customer_experience',
        'scalability',
      ],
      availableData: [
        'Ticket history (Zendesk)',
        'CRM data (HubSpot)',
        'Product usage logs',
        'Sales call recordings',
      ],
      selectedTools: ['Zendesk', 'Slack', 'HubSpot', 'Notion', 'Jira', 'Google Workspace'],
      selectedGoals: [
        'Reduce support response time',
        'Increase ARR',
        'Free up team capacity for strategic work',
      ],
    },
  });

  // 6. Departments (three — Support is the one the Sarah scenario focuses on)
  const departments = [
    { name: 'Support', headcount: 8, avgSalary: 65000, notes: '~400 tickets/day, 4-hr avg response, 40% routine' },
    { name: 'Engineering', headcount: 35, avgSalary: 125000, notes: 'Platform + core product teams' },
    { name: 'Sales', headcount: 14, avgSalary: 95000, notes: 'SDRs + AEs split evenly; long inbound qualification cycle' },
  ];
  for (const dept of departments) {
    await prisma.department.upsert({
      where: { organizationId_name: { organizationId: org.id, name: dept.name } },
      update: { headcount: dept.headcount, avgSalary: dept.avgSalary, notes: dept.notes },
      create: { organizationId: org.id, ...dept },
    });
  }

  // 7. Find the active BASE consultation template (seeded by prisma/seed.ts)
  const baseTemplate = await prisma.consultationTemplate.findFirst({
    where: { type: 'BASE', status: 'ACTIVE' },
    include: { questions: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!baseTemplate) {
    throw new Error(
      'Active BASE consultation template missing — run `npx prisma db seed` first.',
    );
  }

  // 8. Session
  const completedAt = new Date();
  const startedAt = new Date(Date.now() - 24 * 3600 * 1000);

  let session = await prisma.consultationSession.findFirst({
    where: {
      userId: user.id,
      organizationId: org.id,
      baseTemplateId: baseTemplate.id,
    },
  });
  if (!session) {
    session = await prisma.consultationSession.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        baseTemplateId: baseTemplate.id,
        status: 'COMPLETED',
        startedAt,
        completedAt,
      },
    });
  } else {
    session = await prisma.consultationSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', completedAt },
    });
  }

  // 9. Answer each of the 7 base template questions (orderIndex 10..70)
  // Key details map to Sarah/Acme scenario: Zendesk, support bottleneck, ChatGPT Pro etc.
  const answersByOrderIndex: Record<number, unknown> = {
    10: 'Acme SaaS is a customer engagement platform for mid-market SaaS companies — live chat, ticket routing, and in-app messaging. ~120 employees, $18M ARR.',
    20: ['Sales', 'Customer Support', 'Marketing', 'Operations', 'R&D'],
    30: '$500K - $2M',
    40: 'Zendesk for support, HubSpot for CRM, Jira for engineering, Slack for collaboration, Notion for docs, Google Workspace for productivity. ChatGPT Pro used individually by about 30% of employees, but no AI embedded in any workflow.',
    50: 'Support bottleneck: 400 tickets/day, 4-hour average response time, tier-1 spends ~60% of time on routine password/billing issues. Sales team slow to qualify inbound leads. Engineers frequently interrupted for "how does X work?" questions.',
    60: 6,
    70: 'AI-assisted support that frees our team to handle complex issues. Data-driven sales qualification and churn signals. A workforce that ships 2x faster because drudgery is automated.',
  };

  for (const q of baseTemplate.questions) {
    const answer = answersByOrderIndex[q.orderIndex];
    if (answer === undefined) continue;
    await prisma.sessionQuestion.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: q.id } },
      update: {
        answer: answer as Prisma.InputJsonValue,
        answeredAt: completedAt,
        section: 'BASE',
      },
      create: {
        sessionId: session.id,
        questionId: q.id,
        section: 'BASE',
        orderIndex: q.orderIndex,
        answer: answer as Prisma.InputJsonValue,
        answeredAt: completedAt,
      },
    });
  }

  // One adaptive question (the AI would've generated this after reading the answers)
  const adaptiveExisting = await prisma.sessionQuestion.findFirst({
    where: { sessionId: session.id, isAdaptive: true, orderIndex: 1000 },
  });
  const adaptiveAnswer =
    'About 40% routine (password resets, billing). Another 25% are feature-request queries we could answer with a docs search.';
  if (!adaptiveExisting) {
    await prisma.sessionQuestion.create({
      data: {
        sessionId: session.id,
        section: 'ADAPTIVE',
        orderIndex: 1000,
        isAdaptive: true,
        adaptiveText:
          'What percentage of your support tickets are routine (password resets, billing questions)?',
        adaptiveType: 'TEXT',
        answer: adaptiveAnswer as Prisma.InputJsonValue,
        answeredAt: completedAt,
      },
    });
  } else {
    await prisma.sessionQuestion.update({
      where: { id: adaptiveExisting.id },
      data: {
        answer: adaptiveAnswer as Prisma.InputJsonValue,
        answeredAt: completedAt,
      },
    });
  }

  // 10. Transformation Report
  const recommendations = [
    {
      id: REC_IDS.ticketCat,
      title: 'Automated ticket categorization',
      description:
        'Use AI to classify incoming Zendesk tickets by intent and route them to the right queue. Cuts average response time by ~40%.',
      department: 'Support',
      impact: 'HIGH',
      effort: 'LOW',
      annualValue: 43000,
      timeToImplement: '2 weeks',
      prerequisites: ['Zendesk API access', 'Historical ticket labels (last 90 days)'],
      category: 'EFFICIENCY',
    },
    {
      id: REC_IDS.tier1Sugg,
      title: 'AI response suggestions for tier-1',
      description:
        'Draft replies for tier-1 agents from ticket content + knowledge base. Agents review + send with one click. Targets the 40% routine tickets first.',
      department: 'Support',
      impact: 'HIGH',
      effort: 'MEDIUM',
      annualValue: 67000,
      timeToImplement: '4 weeks',
      prerequisites: ['Approved response templates', 'Tier-1 workflow mapping'],
      category: 'EFFICIENCY',
    },
    {
      id: REC_IDS.churn,
      title: 'Predictive churn scoring',
      description:
        'Score accounts weekly for churn risk from product usage + support signals. CSMs act on the top 20% at-risk accounts each week.',
      department: 'Sales',
      impact: 'MEDIUM',
      effort: 'MEDIUM',
      annualValue: 95000,
      timeToImplement: '6 weeks',
      prerequisites: ['Product usage pipeline', 'HubSpot integration'],
      category: 'GROWTH',
    },
    {
      id: REC_IDS.salesOut,
      title: 'AI-drafted sales outreach',
      description:
        'Generate personalized first-touch emails from prospect firmographics + recent activity. SDRs review + send — ~3x throughput.',
      department: 'Sales',
      impact: 'MEDIUM',
      effort: 'LOW',
      annualValue: 38000,
      timeToImplement: '2 weeks',
      prerequisites: ['HubSpot connected', 'Brand voice guidelines'],
      category: 'GROWTH',
    },
    {
      id: REC_IDS.docsRag,
      title: 'Internal docs search assistant',
      description:
        'RAG over Notion + Google Drive so engineers get instant answers to "how does X work?" without interrupting teammates.',
      department: 'Engineering',
      impact: 'MEDIUM',
      effort: 'LOW',
      annualValue: 28000,
      timeToImplement: '2 weeks',
      prerequisites: ['Notion + Drive connected', 'Docs index setup'],
      category: 'EFFICIENCY',
    },
    {
      id: REC_IDS.mtgNotes,
      title: 'AI meeting notes + action items',
      description:
        'Auto-transcribe and summarize calls; extract action items and post to Slack + Jira. Saves ~30 min/meeting.',
      department: 'All',
      impact: 'LOW',
      effort: 'LOW',
      annualValue: 18000,
      timeToImplement: '1 week',
      prerequisites: ['Calendar integration', 'Slack workspace connected'],
      category: 'EXPERIENCE',
    },
  ];

  const implementationPlan = [
    {
      phase: 1,
      name: 'Quick Wins',
      timeframe: 'Weeks 1-4',
      focus: 'Low-effort, high-ROI changes that build momentum',
      totalValue: 43000 + 38000 + 28000 + 18000,
      actions: [
        { title: 'Automated ticket categorization', department: 'Support', value: 43000, effort: 'LOW', status: 'NOT_STARTED' },
        { title: 'AI-drafted sales outreach', department: 'Sales', value: 38000, effort: 'LOW', status: 'NOT_STARTED' },
        { title: 'Internal docs search assistant', department: 'Engineering', value: 28000, effort: 'LOW', status: 'NOT_STARTED' },
        { title: 'AI meeting notes + action items', department: 'All', value: 18000, effort: 'LOW', status: 'NOT_STARTED' },
      ],
    },
    {
      phase: 2,
      name: 'Scale',
      timeframe: 'Weeks 5-10',
      focus: 'Deeper automation on core workflows once the team is bought in',
      totalValue: 67000,
      actions: [
        { title: 'AI response suggestions for tier-1', department: 'Support', value: 67000, effort: 'MEDIUM', status: 'NOT_STARTED' },
      ],
    },
    {
      phase: 3,
      name: 'Differentiate',
      timeframe: 'Weeks 11-16',
      focus: 'Predictive capabilities that become durable competitive advantages',
      totalValue: 95000,
      actions: [
        { title: 'Predictive churn scoring', department: 'Sales', value: 95000, effort: 'MEDIUM', status: 'NOT_STARTED' },
      ],
    },
  ];

  const departmentScores = [
    {
      department: 'Support',
      score: 32,
      maturityLevel: 'AI Curious',
      currentState:
        'Tier-1 handles ~400 tickets/day with 4h avg response. About 60% of agent time goes to routine password/billing issues. No AI tooling in the ticket workflow.',
      potentialState:
        'AI triages and drafts replies to routine tickets. Tier-1 reviews in one click. Avg response drops to under an hour; 2+ agents freed to handle complex issues.',
      efficiencyValue: 43000 + 67000,
      growthValue: 0,
      workflows: [
        {
          name: 'Incoming ticket triage',
          currentProcess: 'Manual reading + tagging by the first available tier-1 agent, routed to specialist queues by hand.',
          aiOpportunity: 'Classify ticket intent + urgency automatically; route to the right queue with 95%+ accuracy.',
          automationPotential: 85,
          weeklyHoursSaved: 12,
          annualValueSaved: 43000,
          effort: 'LOW',
          timeframe: 'WEEKS',
        },
        {
          name: 'First-touch response drafting',
          currentProcess: 'Agent reads ticket, searches knowledge base, copy-pastes template, edits inline.',
          aiOpportunity: 'Pre-draft reply from ticket + KB context. Agent reviews and sends in one click.',
          automationPotential: 70,
          weeklyHoursSaved: 18,
          annualValueSaved: 67000,
          effort: 'MEDIUM',
          timeframe: 'WEEKS',
        },
      ],
    },
    {
      department: 'Sales',
      score: 44,
      maturityLevel: 'AI Curious',
      currentState:
        'SDRs qualify inbound leads manually. Outreach is boilerplate. CSMs see churn only after a cancellation request.',
      potentialState:
        'AI scores leads in real-time and drafts personalized first-touch. Churn risk surfaces weekly so CSMs intervene before cancellations.',
      efficiencyValue: 0,
      growthValue: 95000 + 38000,
      workflows: [
        {
          name: 'Inbound lead outreach',
          currentProcess: 'SDRs manually research + write each first-touch email. ~8 emails/hour.',
          aiOpportunity: 'Generate personalized outreach from firmographics + activity. SDR review + send. 3x throughput.',
          automationPotential: 75,
          weeklyHoursSaved: 10,
          annualValueSaved: 38000,
          effort: 'LOW',
          timeframe: 'WEEKS',
        },
        {
          name: 'Account health + churn signals',
          currentProcess: 'No proactive monitoring. CSMs hear about churn risk when a cancellation ticket arrives.',
          aiOpportunity: 'Weekly churn score from usage + support signals. Top 20% at-risk accounts auto-flagged.',
          automationPotential: 80,
          weeklyHoursSaved: 6,
          annualValueSaved: 95000,
          effort: 'MEDIUM',
          timeframe: 'MONTHS',
        },
      ],
    },
    {
      department: 'Engineering',
      score: 51,
      maturityLevel: 'AI Active',
      currentState:
        'Engineers frequently interrupt each other with "how does X work?" questions. Docs are scattered across Notion and Drive.',
      potentialState:
        'RAG assistant answers internal questions instantly, cites the source doc, and learns from new Notion pages as they land.',
      efficiencyValue: 28000,
      growthValue: 0,
      workflows: [
        {
          name: 'Internal knowledge lookup',
          currentProcess: 'Slack DM a teammate or scroll through Notion/Drive. ~25 min per lookup, often interrupts two people.',
          aiOpportunity: 'Ask a question in Slack → AI answers from indexed Notion + Drive with citations. ~45 sec.',
          automationPotential: 65,
          weeklyHoursSaved: 8,
          annualValueSaved: 28000,
          effort: 'LOW',
          timeframe: 'WEEKS',
        },
      ],
    },
  ];

  const totalAnnualValue = recommendations.reduce((s, r) => s + r.annualValue, 0);
  const totalEfficiency = recommendations
    .filter((r) => r.category === 'EFFICIENCY')
    .reduce((s, r) => s + r.annualValue, 0);
  const totalGrowth = recommendations
    .filter((r) => r.category === 'GROWTH')
    .reduce((s, r) => s + r.annualValue, 0);

  const executiveSummary = {
    summary: `Acme's AI maturity is 38/100 — firmly 'AI Curious.' Six initiatives totaling $${totalAnnualValue.toLocaleString()}/yr in annual value are ready to sequence over 16 weeks, starting with a 2-week ticket-categorization deployment that generates $43K/yr on its own. Support is the most constrained department today and also the highest-ROI starting point.`,
    keyFindings: [
      'Support carries the biggest drag: 60% of tier-1 time goes to routine tickets AI can triage and draft in seconds.',
      '$289K/yr total identified value across six recommendations, with $81K/yr reachable in the first 4 weeks (Quick Wins phase).',
      'Sales has the largest single-initiative upside: predictive churn scoring projects $95K/yr but requires 6 weeks and a product-usage pipeline.',
      'Engineering is the most AI-ready department (score 51) — the docs RAG assistant is a low-effort win that also compounds team velocity.',
      'Team AI literacy is uneven — plan ~2 hours of role-specific training alongside each rollout so adoption sticks.',
    ],
  };

  await prisma.transformationReport.upsert({
    where: { sessionId: session.id },
    update: {
      status: 'COMPLETED',
      overallScore: 38,
      maturityLevel: 'AI Curious',
      totalEfficiencyValue: totalEfficiency,
      totalGrowthValue: totalGrowth,
      totalAiValue: totalAnnualValue,
      fteRedeployable: 2.4,
      recommendations: recommendations as unknown as Prisma.InputJsonValue,
      implementationPlan: implementationPlan as unknown as Prisma.InputJsonValue,
      departmentScores: departmentScores as unknown as Prisma.InputJsonValue,
      executiveSummary: executiveSummary as unknown as Prisma.InputJsonValue,
      generatedAt: completedAt,
    },
    create: {
      sessionId: session.id,
      organizationId: org.id,
      status: 'COMPLETED',
      overallScore: 38,
      maturityLevel: 'AI Curious',
      totalEfficiencyValue: totalEfficiency,
      totalGrowthValue: totalGrowth,
      totalAiValue: totalAnnualValue,
      fteRedeployable: 2.4,
      recommendations: recommendations as unknown as Prisma.InputJsonValue,
      implementationPlan: implementationPlan as unknown as Prisma.InputJsonValue,
      departmentScores: departmentScores as unknown as Prisma.InputJsonValue,
      executiveSummary: executiveSummary as unknown as Prisma.InputJsonValue,
      generatedAt: completedAt,
    },
  });

  // 11. Long-lived OTP so demo login works without SMTP
  await prisma.otpCode.deleteMany({
    where: { userId: user.id, code: DEMO_OTP },
  });
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      code: DEMO_OTP,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  console.log('\n✓ Demo seed complete\n');
  console.log(`  Login email:   ${DEMO_EMAIL}`);
  console.log(`  OTP code:      ${DEMO_OTP}  (valid 30 days)`);
  console.log(`  Organization:  ${ORG_NAME}`);
  console.log(`  Identified:    $${totalAnnualValue.toLocaleString()}/yr across ${recommendations.length} recommendations`);
  console.log(`  Session ID:    ${session.id}`);
  console.log('');
  console.log('Next: log in → Tracker → Import from Report → six cards appear in BACKLOG.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
