-- CreateEnum
CREATE TYPE "DeploymentPlanStatus" AS ENUM ('DRAFT', 'PLANNING', 'PLAN_READY', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('IMPLEMENTATION_GUIDE', 'CONFIGURATION_TEMPLATE', 'INTEGRATION_CHECKLIST', 'VENDOR_EVALUATION', 'CODE_SNIPPET', 'CUSTOM');

-- CreateTable
CREATE TABLE "deployment_plans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "DeploymentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "conversation_history" JSONB,
    "steps" JSONB,
    "prerequisites" JSONB,
    "risks" JSONB,
    "estimated_duration" TEXT,
    "suggested_artifacts" JSONB,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "rejection_note" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_artifacts" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployment_plans_organization_id_idx" ON "deployment_plans"("organization_id");

-- CreateIndex
CREATE INDEX "deployment_plans_action_id_idx" ON "deployment_plans"("action_id");

-- CreateIndex
CREATE INDEX "deployment_artifacts_plan_id_idx" ON "deployment_artifacts"("plan_id");

-- AddForeignKey
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "transformation_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_artifacts" ADD CONSTRAINT "deployment_artifacts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "deployment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
