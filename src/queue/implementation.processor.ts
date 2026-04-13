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

@Processor('implementation', { concurrency: 1 })
export class ImplementationProcessor extends WorkerHost {
  private readonly logger = new Logger(ImplementationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private implementationAi: ImplementationAiService,
  ) {
    super();
  }

  async process(
    job: Job<GeneratePlanJob | RefinePlanJob | GenerateArtifactsJob>,
  ) {
    switch (job.name) {
      case 'generate-plan':
        return this.handleGeneratePlan(job.data as GeneratePlanJob);
      case 'refine-plan':
        return this.handleRefinePlan(job.data as RefinePlanJob);
      case 'generate-artifacts':
        return this.handleGenerateArtifacts(job.data as GenerateArtifactsJob);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
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

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `[${data.planId}] Plan generation completed in ${elapsed}s — ${plan.steps.length} steps`,
      );
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

  private async handleGenerateArtifacts(data: GenerateArtifactsJob) {
    const start = Date.now();
    this.logger.log(`[${data.planId}] Starting artifact generation`);

    try {
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'EXECUTING' },
      });

      const plan = await this.prisma.deploymentPlan.findUniqueOrThrow({
        where: { id: data.planId },
        include: {
          action: true,
          organization: { include: { industry: true } },
        },
      });

      const artifactTypes = (plan.suggestedArtifacts as ArtifactType[]) || [
        'IMPLEMENTATION_GUIDE',
        'INTEGRATION_CHECKLIST',
      ];

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

      // Generate each artifact sequentially to avoid rate limiting
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

      // Mark plan as completed
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Auto-advance action to DEPLOYED
      await this.prisma.transformationAction.update({
        where: { id: plan.actionId },
        data: { status: 'DEPLOYED', deployedAt: new Date() },
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `[${data.planId}] Artifact generation completed in ${elapsed}s — ${artifactTypes.length} artifacts`,
      );
    } catch (error) {
      this.logger.error(
        `[${data.planId}] Artifact generation failed: ${(error as Error).message}`,
      );
      await this.prisma.deploymentPlan.update({
        where: { id: data.planId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
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
        conversationHistory: conversationHistory as any,
      },
    });
  }
}
