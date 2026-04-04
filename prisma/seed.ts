import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ─── Industries ──────────────────────────────────────
  const industries = [
    { name: 'Healthcare', normalizedKey: 'healthcare', aliases: ['health', 'medical', 'hospital'] },
    { name: 'Financial Services', normalizedKey: 'financial_services', aliases: ['finance', 'banking', 'fintech'] },
    { name: 'Retail & E-Commerce', normalizedKey: 'retail_ecommerce', aliases: ['retail', 'ecommerce', 'e-commerce'] },
    { name: 'Manufacturing', normalizedKey: 'manufacturing', aliases: ['factory', 'production'] },
    { name: 'Technology & SaaS', normalizedKey: 'technology_saas', aliases: ['tech', 'saas', 'software', 'it'] },
    { name: 'Education', normalizedKey: 'education', aliases: ['edtech', 'academic', 'university'] },
    { name: 'Government & Public Sector', normalizedKey: 'government_public_sector', aliases: ['government', 'public_sector', 'federal'] },
    { name: 'Real Estate', normalizedKey: 'real_estate', aliases: ['property', 'realestate', 'proptech'] },
    { name: 'Legal Services', normalizedKey: 'legal_services', aliases: ['legal', 'law', 'legaltech'] },
    { name: 'Logistics & Supply Chain', normalizedKey: 'logistics_supply_chain', aliases: ['logistics', 'supply_chain', 'shipping'] },
    { name: 'Energy & Utilities', normalizedKey: 'energy_utilities', aliases: ['energy', 'utilities', 'oil_gas', 'renewable'] },
    { name: 'Media & Entertainment', normalizedKey: 'media_entertainment', aliases: ['media', 'entertainment', 'streaming'] },
    { name: 'Telecommunications', normalizedKey: 'telecommunications', aliases: ['telecom', 'telco'] },
    { name: 'Agriculture', normalizedKey: 'agriculture', aliases: ['agtech', 'farming'] },
    { name: 'Hospitality & Tourism', normalizedKey: 'hospitality_tourism', aliases: ['hospitality', 'tourism', 'hotel', 'travel'] },
    { name: 'Construction', normalizedKey: 'construction', aliases: ['building', 'infrastructure'] },
    { name: 'Professional Services', normalizedKey: 'professional_services', aliases: ['consulting', 'advisory'] },
    { name: 'Non-Profit', normalizedKey: 'non_profit', aliases: ['nonprofit', 'ngo', 'charity'] },
    { name: 'Automotive', normalizedKey: 'automotive', aliases: ['auto', 'vehicle', 'car'] },
    { name: 'Pharma & Biotech', normalizedKey: 'pharma_biotech', aliases: ['pharmaceutical', 'biotech', 'pharma'] },
  ];

  for (const industry of industries) {
    await prisma.industry.upsert({
      where: { normalizedKey: industry.normalizedKey },
      update: {},
      create: industry,
    });
  }
  console.log(`Seeded ${industries.length} industries`);

  // ─── Challenge Areas ─────────────────────────────────
  const challengeAreas = [
    { name: 'Change Management', normalizedKey: 'change_management', description: 'Managing organizational change during transformation' },
    { name: 'Data Quality', normalizedKey: 'data_quality', description: 'Ensuring data accuracy, completeness, and reliability' },
    { name: 'Legacy Systems', normalizedKey: 'legacy_systems', description: 'Modernizing or integrating with legacy infrastructure' },
    { name: 'Customer Experience', normalizedKey: 'customer_experience', description: 'Improving customer-facing processes and interactions' },
    { name: 'Operational Efficiency', normalizedKey: 'operational_efficiency', description: 'Streamlining internal operations and workflows' },
    { name: 'Compliance & Regulation', normalizedKey: 'compliance_regulation', description: 'Meeting regulatory requirements and industry standards' },
    { name: 'Workforce Training', normalizedKey: 'workforce_training', description: 'Upskilling employees for new technologies' },
    { name: 'Cost Reduction', normalizedKey: 'cost_reduction', description: 'Reducing operational and technology costs' },
    { name: 'Process Automation', normalizedKey: 'process_automation', description: 'Automating manual and repetitive processes' },
    { name: 'Decision Making', normalizedKey: 'decision_making', description: 'Enhancing data-driven decision making capabilities' },
    { name: 'Security & Privacy', normalizedKey: 'security_privacy', description: 'Protecting data and maintaining privacy compliance' },
    { name: 'Scalability', normalizedKey: 'scalability', description: 'Scaling systems and processes for growth' },
    { name: 'Innovation Speed', normalizedKey: 'innovation_speed', description: 'Accelerating time-to-market for new initiatives' },
    { name: 'Supply Chain Optimization', normalizedKey: 'supply_chain_optimization', description: 'Optimizing supply chain processes and visibility' },
    { name: 'Revenue Growth', normalizedKey: 'revenue_growth', description: 'Identifying and capitalizing on new revenue opportunities' },
  ];

  for (const ca of challengeAreas) {
    await prisma.challengeArea.upsert({
      where: { normalizedKey: ca.normalizedKey },
      update: {},
      create: ca,
    });
  }
  console.log(`Seeded ${challengeAreas.length} challenge areas`);

  // ─── Base Template ───────────────────────────────────
  const existingBase = await prisma.consultationTemplate.findFirst({
    where: { type: 'BASE', status: 'ACTIVE' },
  });

  if (!existingBase) {
    const baseTemplate = await prisma.consultationTemplate.create({
      data: {
        type: 'BASE',
        status: 'ACTIVE',
        version: 1,
      },
    });

    const baseQuestions = [
      {
        questionText: 'Describe your organization\'s core products or services.',
        questionType: 'TEXT' as const,
        orderIndex: 10,
      },
      {
        questionText: 'What are your primary business functions?',
        questionType: 'MULTI_CHOICE' as const,
        options: ['Sales', 'Marketing', 'Operations', 'Customer Support', 'Finance', 'HR', 'R&D', 'Manufacturing', 'Logistics', 'Other'],
        orderIndex: 20,
      },
      {
        questionText: 'What is your organization\'s current annual technology budget range?',
        questionType: 'SINGLE_CHOICE' as const,
        options: ['Less than $100K', '$100K - $500K', '$500K - $2M', '$2M - $10M', '$10M+'],
        orderIndex: 30,
      },
      {
        questionText: 'Describe your current technology landscape and key tools/platforms.',
        questionType: 'TEXT' as const,
        orderIndex: 40,
      },
      {
        questionText: 'What are the top challenges your organization faces today?',
        questionType: 'TEXT' as const,
        orderIndex: 50,
      },
      {
        questionText: 'How would you rate your organization\'s overall digital maturity?',
        questionType: 'SCALE' as const,
        orderIndex: 60,
      },
      {
        questionText: 'What does a successful AI transformation look like for your organization?',
        questionType: 'TEXT' as const,
        orderIndex: 70,
      },
    ];

    for (const q of baseQuestions) {
      await prisma.templateQuestion.create({
        data: {
          templateId: baseTemplate.id,
          ...q,
        },
      });
    }

    console.log(`Seeded base template with ${baseQuestions.length} questions`);
  } else {
    console.log('Base template already exists, skipping');
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
