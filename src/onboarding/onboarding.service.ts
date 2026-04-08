import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { StorageService } from '../storage';
import { AiService } from '../ai';
import { SaveProgressDto, SubmitOnboardingDto } from './dto';
import { v4 as uuidv4 } from 'uuid';

// Fields that map directly from DTO to Prisma model
const ONBOARDING_DATA_FIELDS = [
  'companyName',
  'companyUrl',
  'industryId',
  'customIndustry',
  'companySize',
  'businessDescription',
  'revenueStreams',
  'selectedChallenges',
  'customChallenges',
  'availableData',
  'customDataSources',
  'selectedTools',
  'customTools',
  'selectedGoals',
  'customGoals',
] as const;

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiService,
  ) {}

  async getStatus(organizationId: string) {
    const onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
      include: {
        documents: {
          select: {
            id: true,
            name: true,
            type: true,
            size: true,
            uploadedAt: true,
          },
        },
      },
    });

    if (!onboarding) {
      return {
        completed: false,
        currentStep: 1,
        data: null,
        documents: [],
      };
    }

    const data: Record<string, unknown> = {};
    for (const field of ONBOARDING_DATA_FIELDS) {
      data[field] =
        onboarding[field] ??
        (field.startsWith('selected') || field === 'availableData' ? [] : '');
    }

    return {
      completed: onboarding.completed,
      currentStep: onboarding.currentStep,
      data,
      documents: onboarding.documents,
    };
  }

  async getProfile(organizationId: string) {
    const onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
      include: {
        organization: {
          include: { industry: true },
        },
        documents: {
          select: {
            id: true,
            name: true,
            type: true,
            size: true,
            uploadedAt: true,
          },
        },
      },
    });

    if (!onboarding) {
      throw new NotFoundException('Onboarding data not found');
    }

    return {
      companyName: onboarding.companyName,
      companyUrl: onboarding.companyUrl || null,
      industry: onboarding.organization.industry
        ? {
            id: onboarding.organization.industry.id,
            name: onboarding.organization.industry.name,
          }
        : null,
      customIndustry: onboarding.customIndustry || null,
      companySize: onboarding.companySize || null,
      businessDescription: onboarding.businessDescription || null,
      revenueStreams: onboarding.revenueStreams || null,
      challenges: {
        selected: onboarding.selectedChallenges,
        custom: onboarding.customChallenges || null,
      },
      dataAvailability: {
        selected: onboarding.availableData,
        custom: onboarding.customDataSources || null,
      },
      tools: {
        selected: onboarding.selectedTools,
        custom: onboarding.customTools || null,
      },
      goals: {
        selected: onboarding.selectedGoals,
        custom: onboarding.customGoals || null,
      },
      documents: onboarding.documents,
      completedAt: onboarding.updatedAt,
    };
  }

  async getInsights(organizationId: string) {
    const onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
      include: {
        organization: { include: { industry: true } },
      },
    });

    if (!onboarding || !onboarding.completed) {
      throw new BadRequestException(
        'Onboarding must be completed before generating insights',
      );
    }

    // Return cached insights if available
    if (onboarding.aiInsights && onboarding.insightsAt) {
      return onboarding.aiInsights;
    }

    const insights = await this.ai.generateOnboardingInsights({
      companyName: onboarding.companyName || '',
      industry: onboarding.organization.industry?.name || 'Unknown',
      companySize: onboarding.companySize,
      businessDescription: onboarding.businessDescription || '',
      revenueStreams: onboarding.revenueStreams || '',
      challenges: onboarding.selectedChallenges,
      dataAvailability: onboarding.availableData,
      tools: onboarding.selectedTools,
      goals: onboarding.selectedGoals,
    });

    // Cache the result
    await this.prisma.onboarding.update({
      where: { organizationId },
      data: { aiInsights: insights as any, insightsAt: new Date() },
    });

    return insights;
  }

  async saveProgress(organizationId: string, dto: SaveProgressDto) {
    const updateData: Record<string, unknown> = {
      currentStep: dto.step,
    };

    if (dto.data) {
      for (const field of ONBOARDING_DATA_FIELDS) {
        if (field in dto.data) {
          updateData[field] = dto.data[field];
        }
      }
    }

    await this.prisma.onboarding.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...updateData,
      },
      update: updateData,
    });

    return { success: true };
  }

  async submit(
    userId: string,
    organizationId: string,
    dto: SubmitOnboardingDto,
  ) {
    // Validate cross-field requirements
    this.validateSubmission(dto);

    // Verify industry exists
    const industry = await this.prisma.industry.findUnique({
      where: { id: dto.industryId },
    });
    if (!industry) {
      throw new BadRequestException('Invalid industryId');
    }

    // Build the data object from DTO
    const onboardingData: Record<string, unknown> = {
      completed: true,
      currentStep: 7,
    };
    for (const field of ONBOARDING_DATA_FIELDS) {
      if (dto[field] !== undefined) {
        onboardingData[field] = dto[field];
      }
    }

    // Use a transaction to ensure atomicity
    await this.prisma.$transaction(async (tx) => {
      // Upsert onboarding record and invalidate cached insights
      await tx.onboarding.upsert({
        where: { organizationId },
        create: {
          organizationId,
          ...onboardingData,
        },
        update: {
          ...onboardingData,
          aiInsights: Prisma.DbNull,
          insightsAt: null,
        },
      });

      // Mark user onboarding as completed
      await tx.user.update({
        where: { id: userId },
        data: { onboardingCompleted: true },
      });

      // Optionally update organization details
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          name: dto.companyName,
          industryId: dto.industryId,
          ...(dto.companySize && { size: dto.companySize }),
        },
      });
    });

    return { success: true, message: 'Onboarding completed successfully' };
  }

  async uploadDocument(organizationId: string, file: Express.Multer.File) {
    // Ensure onboarding record exists
    let onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
    });

    if (!onboarding) {
      onboarding = await this.prisma.onboarding.create({
        data: { organizationId },
      });
    }

    const documentId = uuidv4();
    const storagePath = this.storage.buildOnboardingPath(
      organizationId,
      documentId,
      file.originalname,
    );

    // Save file to storage
    await this.storage.saveFile(storagePath, file.buffer);

    // Create document record
    const document = await this.prisma.onboardingDocument.create({
      data: {
        id: documentId,
        onboardingId: onboarding.id,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        storagePath,
      },
      select: {
        id: true,
        name: true,
        type: true,
        size: true,
        uploadedAt: true,
        url: true,
      },
    });

    return document;
  }

  async deleteDocument(documentId: string, organizationId: string) {
    // Find the document and verify ownership
    const document = await this.prisma.onboardingDocument.findUnique({
      where: { id: documentId },
      include: { onboarding: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.onboarding.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this document');
    }

    // Delete from storage
    await this.storage.deleteFile(document.storagePath);

    // Delete database record
    await this.prisma.onboardingDocument.delete({
      where: { id: documentId },
    });

    return { success: true };
  }

  private validateSubmission(dto: SubmitOnboardingDto): void {
    const errors: Record<string, string[]> = {};

    // Challenges: at least one of selectedChallenges or customChallenges
    if (
      (!dto.selectedChallenges || dto.selectedChallenges.length === 0) &&
      (!dto.customChallenges || dto.customChallenges.trim().length === 0)
    ) {
      errors.challenges = [
        'At least one challenge must be selected or a custom challenge must be provided',
      ];
    }

    // Data sources: at least one of availableData or customDataSources
    if (
      (!dto.availableData || dto.availableData.length === 0) &&
      (!dto.customDataSources || dto.customDataSources.trim().length === 0)
    ) {
      errors.dataSources = [
        'At least one data source must be selected or a custom data source must be provided',
      ];
    }

    // Tools: at least one of selectedTools or customTools
    if (
      (!dto.selectedTools || dto.selectedTools.length === 0) &&
      (!dto.customTools || dto.customTools.trim().length === 0)
    ) {
      errors.tools = [
        'At least one tool must be selected or a custom tool must be provided',
      ];
    }

    // Goals: at least one of selectedGoals or customGoals
    if (
      (!dto.selectedGoals || dto.selectedGoals.length === 0) &&
      (!dto.customGoals || dto.customGoals.trim().length === 0)
    ) {
      errors.goals = [
        'At least one goal must be selected or a custom goal must be provided',
      ];
    }

    if (Object.keys(errors).length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors,
      });
    }
  }
}
