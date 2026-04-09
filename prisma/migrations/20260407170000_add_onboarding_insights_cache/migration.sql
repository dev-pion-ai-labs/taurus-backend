-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationLevel" AS ENUM ('NONE', 'LOW', 'MODERATE', 'HIGH', 'FULL');

-- CreateEnum
CREATE TYPE "WorkflowPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "onboarding_completed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "onboardings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "company_name" TEXT,
    "company_url" TEXT,
    "industry_id" TEXT,
    "custom_industry" TEXT,
    "company_size" TEXT,
    "business_description" TEXT,
    "revenue_streams" TEXT,
    "selected_challenges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_challenges" TEXT,
    "available_data" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_data_sources" TEXT,
    "selected_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_tools" TEXT,
    "selected_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_goals" TEXT,
    "ai_insights" JSONB,
    "insights_at" TIMESTAMP(3),
    "scraped_content" JSONB,
    "scraped_at" TIMESTAMP(3),
    "scraping_status" TEXT DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_documents" (
    "id" TEXT NOT NULL,
    "onboarding_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "url" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformation_reports" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "overall_score" INTEGER,
    "maturity_level" TEXT,
    "total_efficiency_value" DOUBLE PRECISION,
    "total_growth_value" DOUBLE PRECISION,
    "total_ai_value" DOUBLE PRECISION,
    "fte_redeployable" DOUBLE PRECISION,
    "executive_summary" JSONB,
    "department_scores" JSONB,
    "recommendations" JSONB,
    "implementation_plan" JSONB,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headcount" INTEGER,
    "avg_salary" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weekly_hours" DOUBLE PRECISION,
    "people_involved" INTEGER,
    "automation_level" "AutomationLevel" NOT NULL DEFAULT 'NONE',
    "pain_points" TEXT,
    "priority" "WorkflowPriority" NOT NULL DEFAULT 'MEDIUM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboardings_organization_id_key" ON "onboardings"("organization_id");

-- CreateIndex
CREATE INDEX "onboarding_documents_onboarding_id_idx" ON "onboarding_documents"("onboarding_id");

-- CreateIndex
CREATE UNIQUE INDEX "transformation_reports_session_id_key" ON "transformation_reports"("session_id");

-- CreateIndex
CREATE INDEX "transformation_reports_organization_id_idx" ON "transformation_reports"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_name_key" ON "departments"("organization_id", "name");

-- CreateIndex
CREATE INDEX "departments_organization_id_idx" ON "departments"("organization_id");

-- CreateIndex
CREATE INDEX "workflows_department_id_idx" ON "workflows"("department_id");

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_reports" ADD CONSTRAINT "transformation_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consultation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_reports" ADD CONSTRAINT "transformation_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
