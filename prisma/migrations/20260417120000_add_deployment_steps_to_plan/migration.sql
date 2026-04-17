-- Add deployment_steps column to deployment_plans
-- Holds the structured tool-invocation plan (provider, tool, params, dependsOn) that
-- the PlanExecutor will consume at deploy time. Emitted by the implementation AI
-- alongside the markdown plan.
ALTER TABLE "deployment_plans" ADD COLUMN "deployment_steps" JSONB;
