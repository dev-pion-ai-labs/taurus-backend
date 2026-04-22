import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ArtifactType } from '@prisma/client';
import { PrismaService } from '../prisma';
import {
  ImplementationAiService,
  type PlanResult,
} from '../ai/implementation-ai.service';
import type { ArtifactGenerationContext } from '../ai/prompts/implementation-artifact.prompt';
import { SlackService } from '../integrations/services/slack.service';
import { PlanExecutorService } from '../implementation/plan-executor.service';

interface GeneratePlanJob {
  planId: string;
  actionId: string;
  orgId: string;
}

interface RefinePlanJob {
  planId: string;
  orgId: string;
  userMessage: string;
}

interface GenerateArtifactsJob {
  planId: string;
  orgId: string;
}

interface ExecutePlanJob {
  planId: string;
  orgId: string;
  userId: string;
}

type ImplementationJob =
  | GeneratePlanJob
  | RefinePlanJob
  | GenerateArtifactsJob
  | ExecutePlanJob;

@Processor('implementation', { concurrency: 1 })
export class ImplementationProcessor extends WorkerHost {
  private readonly logger = new Logger(ImplementationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private implementationAi: ImplementationAiService,
    private slack: SlackService,
    private planExecutor: PlanExecutorService,
  ) {
    super();
  }

  async process(job: Job<ImplementationJob>) {
    switch (job.name) {
      case 'generate-plan':
        return this.handleGeneratePlan(job.data as GeneratePlanJob);
      case 'refine-plan':
        return this.handleRefinePlan(job.data as RefinePlanJob);
      case 'generate-artifacts':
        return this.handleGenerateArtifacts(job.data as GenerateArtifactsJob);
      case 'execute-plan':
        return this.handleExecutePlan(job.data as ExecutePlanJob);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleExecutePlan(data: ExecutePlanJob) {
    const start = Date.now();
    this.logger.log(`[${data.planId}] Starting plan execution`);

    await this.prisma.deploymentPlan.update({
      where: { id: data.planId },
      data: { status: 'EXECUTING' },
    });

    try {
      const summary = await this.planExecutor.execute(
        data.planId,
        data.orgId,
        data.userId,
      );

      const allSucceeded = summary.failed === 0 && summary.skipped === 0;
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: {
          status: allSucceeded ? 'COMPLETED' : 'FAILED',
          completedAt: allSucceeded ? new Date() : undefined,
        },
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `[${data.planId}] Plan execution finished in ${elapsed}s — ${summary.completed}/${summary.total} completed, ${summary.failed} failed`,
      );
    } catch (error) {
      this.logger.error(
        `[${data.planId}] Plan execution crashed: ${(error as Error).message}`,
      );
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  private async handleGeneratePlan(data: GeneratePlanJob) {
    const start = Date.now();
    this.logger.log(`[${data.planId}] Starting plan generation`);

    try {
      // Update status to PLANNING
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'PLANNING' },
      });

      // Get the action details
      const action = await this.prisma.transformationAction.findUniqueOrThrow({
        where: { id: data.actionId },
      });

      // Run the agent loop
      const { plan, conversationHistory } =
        await this.implementationAi.generatePlan(
          {
            actionId: action.id,
            actionTitle: action.title,
            actionDescription: action.description,
            actionDepartment: action.department,
            actionCategory: action.category,
            actionEstimatedValue: action.estimatedValue,
            actionEstimatedEffort: action.estimatedEffort,
          },
          data.orgId,
        );

      // Save the plan
      await this.savePlan(data.planId, plan, conversationHistory);

      // Notify Slack
      this.slack
        .notifyPlanReady(data.orgId, plan.title, action.title, plan.steps.length)
        .catch(() => {}); // fire-and-forget

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const deployCount = plan.deploymentSteps?.length ?? 0;
      this.logger.log(
        `[${data.planId}] Plan generation completed in ${elapsed}s — ${plan.steps.length} narrative steps, ${deployCount} executable deploymentSteps`,
      );
      if (plan.steps.length > 0 && deployCount === 0) {
        this.logger.warn(
          `[${data.planId}] Plan has narrative steps but no executable deploymentSteps — user will see nothing to deploy. Check AI output / sanitizer warnings above.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${data.planId}] Plan generation failed: ${(error as Error).message}`,
      );
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  private async handleRefinePlan(data: RefinePlanJob) {
    const start = Date.now();
    this.logger.log(`[${data.planId}] Starting plan refinement`);

    try {
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'PLANNING' },
      });

      const plan = await this.prisma.deploymentPlan.findUniqueOrThrow({
        where: { id: data.planId },
      });

      const existingHistory = (plan.conversationHistory as unknown[]) || [];
      const { plan: refined, conversationHistory } =
        await this.implementationAi.refinePlan(
          data.userMessage,
          existingHistory as any[],
          data.orgId,
        );

      await this.savePlan(data.planId, refined, conversationHistory);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `[${data.planId}] Plan refinement completed in ${elapsed}s`,
      );
    } catch (error) {
      this.logger.error(
        `[${data.planId}] Plan refinement failed: ${(error as Error).message}`,
      );
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  /**
   * Opt-in only: generates the artifact types listed on plan.suggestedArtifacts.
   * Not part of the approve→execute critical path anymore. Invoked only when
   * the plan explicitly requests artifacts (e.g. INTEGRATION_CHECKLIST for a
   * high-risk rollout). If suggestedArtifacts is empty, the handler no-ops —
   * it never mutates plan/action status, so it's safe to run alongside or
   * after execution.
   */
  private async handleGenerateArtifacts(data: GenerateArtifactsJob) {
    const start = Date.now();

    const plan = await this.prisma.deploymentPlan.findUniqueOrThrow({
      where: { id: data.planId },
      include: {
        action: true,
        organization: { include: { industry: true } },
      },
    });

    const artifactTypes = (plan.suggestedArtifacts as ArtifactType[]) ?? [];
    if (artifactTypes.length === 0) {
      this.logger.log(
        `[${data.planId}] No suggested artifacts — skipping generation`,
      );
      return;
    }

    this.logger.log(
      `[${data.planId}] Starting opt-in artifact generation (${artifactTypes.length})`,
    );

    const artifactContext: ArtifactGenerationContext = {
      planTitle: plan.title,
      planSummary: plan.summary,
      planSteps: plan.steps,
      planPrerequisites: plan.prerequisites,
      planRisks: plan.risks,
      actionTitle: plan.action.title,
      actionDescription: plan.action.description,
      actionDepartment: plan.action.department,
      organizationName: plan.organization.name,
      industry: plan.organization.industry?.name || 'Unknown',
    };

    for (let i = 0; i < artifactTypes.length; i++) {
      const type = artifactTypes[i];
      this.logger.log(
        `[${data.planId}] Generating artifact ${i + 1}/${artifactTypes.length}: ${type}`,
      );

      const artifact = await this.implementationAi.generateArtifact(
        type,
        artifactContext,
      );

      await this.prisma.deploymentArtifact.create({
        data: {
          planId: data.planId,
          type,
          title: artifact.title,
          content: artifact.content,
          orderIndex: i,
        },
      });
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    this.logger.log(
      `[${data.planId}] Artifact generation completed in ${elapsed}s — ${artifactTypes.length} artifacts`,
    );
  }

  private async savePlan(
    planId: string,
    plan: PlanResult,
    conversationHistory: unknown[],
  ) {
    await this.prisma.deploymentPlan.update({
      where: { id: planId },
      data: {
        status: 'PLAN_READY',
        title: plan.title,
        summary: plan.summary,
        steps: plan.steps as any,
        prerequisites: plan.prerequisites as any,
        risks: plan.risks as any,
        estimatedDuration: plan.estimatedDuration,
        suggestedArtifacts: plan.suggestedArtifacts as any,
        deploymentSteps: plan.deploymentSteps as any,
        conversationHistory: conversationHistory as any,
      },
    });
  }
}
