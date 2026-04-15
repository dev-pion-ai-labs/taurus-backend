-- Add NOTION to IntegrationProvider enum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'NOTION';

-- Create DeploymentSessionStatus enum
CREATE TYPE "DeploymentSessionStatus" AS ENUM ('PREPARING', 'DRY_RUN', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- Create DeploymentStepStatus enum
CREATE TYPE "DeploymentStepStatus" AS ENUM ('PENDING', 'DRY_RUN', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- Create deployment_sessions table
CREATE TABLE "deployment_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "DeploymentSessionStatus" NOT NULL DEFAULT 'PREPARING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_sessions_pkey" PRIMARY KEY ("id")
);

-- Create deployment_steps table
CREATE TABLE "deployment_steps" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "integration_id" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order_index" INTEGER NOT NULL,
    "status" "DeploymentStepStatus" NOT NULL DEFAULT 'PENDING',
    "dry_run_result" JSONB,
    "result" JSONB,
    "error" TEXT,
    "audit_log_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "deployment_steps_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "deployment_sessions_organization_id_idx" ON "deployment_sessions"("organization_id");
CREATE INDEX "deployment_sessions_plan_id_idx" ON "deployment_sessions"("plan_id");
CREATE INDEX "deployment_steps_session_id_idx" ON "deployment_steps"("session_id");

-- Add foreign keys
ALTER TABLE "deployment_sessions" ADD CONSTRAINT "deployment_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_sessions" ADD CONSTRAINT "deployment_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "deployment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_steps" ADD CONSTRAINT "deployment_steps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "deployment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
