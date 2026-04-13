-- CreateEnum
CREATE TYPE "ToolCategory" AS ENUM ('AI_PLATFORM', 'AUTOMATION', 'ANALYTICS', 'CRM', 'COMMUNICATION', 'DEVELOPMENT', 'SECURITY', 'INDUSTRY_SPECIFIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ToolSource" AS ENUM ('ONBOARDING', 'CONSULTATION', 'DISCOVERY', 'RECOMMENDATION', 'MANUAL');

-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('IDENTIFIED', 'EVALUATING', 'ACTIVE', 'DEPRECATED');

-- CreateTable
CREATE TABLE "discovery_reports" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "email" TEXT,
    "organization_id" TEXT,
    "score" INTEGER,
    "maturity_level" TEXT,
    "industry" TEXT,
    "company_size" TEXT,
    "tech_stack" JSONB,
    "ai_signals" JSONB,
    "summary" TEXT,
    "recommendations" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "scraped_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ToolCategory" NOT NULL DEFAULT 'OTHER',
    "source" "ToolSource" NOT NULL DEFAULT 'MANUAL',
    "source_id" TEXT,
    "status" "ToolStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "department_ids" JSONB,
    "monthly_cost" DOUBLE PRECISION,
    "user_count" INTEGER,
    "rating" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_reports_domain_idx" ON "discovery_reports"("domain");

-- CreateIndex
CREATE INDEX "discovery_reports_organization_id_idx" ON "discovery_reports"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_entries_organization_id_name_key" ON "tool_entries"("organization_id", "name");

-- CreateIndex
CREATE INDEX "tool_entries_organization_id_category_idx" ON "tool_entries"("organization_id", "category");

-- AddForeignKey
ALTER TABLE "discovery_reports" ADD CONSTRAINT "discovery_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_entries" ADD CONSTRAINT "tool_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
