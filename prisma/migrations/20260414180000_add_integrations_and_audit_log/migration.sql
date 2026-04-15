-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SLACK', 'GITHUB', 'ZAPIER', 'MAKE', 'N8N_CLOUD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('OAUTH2', 'API_KEY', 'BEARER_TOKEN');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "org_integrations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "label" TEXT,
    "auth_type" "AuthType" NOT NULL,
    "credentials" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "integration_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "status" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "rollback_data" JSONB,
    "executed_by" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),

    CONSTRAINT "deployment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_integrations_organization_id_idx" ON "org_integrations"("organization_id");

-- CreateIndex
CREATE INDEX "org_integrations_status_idx" ON "org_integrations"("status");

-- CreateIndex
CREATE INDEX "org_integrations_expires_at_idx" ON "org_integrations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "org_integrations_organization_id_provider_label_key" ON "org_integrations"("organization_id", "provider", "label");

-- CreateIndex
CREATE INDEX "deployment_audit_logs_organization_id_idx" ON "deployment_audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "deployment_audit_logs_integration_id_idx" ON "deployment_audit_logs"("integration_id");

-- CreateIndex
CREATE INDEX "deployment_audit_logs_plan_id_idx" ON "deployment_audit_logs"("plan_id");

-- AddForeignKey
ALTER TABLE "org_integrations" ADD CONSTRAINT "org_integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_audit_logs" ADD CONSTRAINT "deployment_audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_audit_logs" ADD CONSTRAINT "deployment_audit_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "org_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
