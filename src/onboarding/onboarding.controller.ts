import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../common';
import { OnboardingService } from './onboarding.service';
import { SaveProgressDto, SubmitOnboardingDto } from './dto';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @Get('status')
  getStatus(
    @CurrentUser() user: { id: string; organizationId: string | null },
  ) {
    if (!user.organizationId) {
      return {
        completed: false,
        currentStep: 1,
        data: null,
        documents: [],
      };
    }
    return this.onboardingService.getStatus(user.organizationId);
  }

  @Get('profile')
  getProfile(
    @CurrentUser() user: { id: string; organizationId: string | null },
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.onboardingService.getProfile(user.organizationId);
  }

  @Get('insights')
  getInsights(
    @CurrentUser() user: { id: string; organizationId: string | null },
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.onboardingService.getInsights(user.organizationId);
  }

  @Get('scraping-status')
  getScrapingStatus(
    @CurrentUser() user: { id: string; organizationId: string | null },
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.onboardingService.getScrapingStatus(user.organizationId);
  }

  @Post('scrape')
  startScraping(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Body() body: { companyUrl: string },
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.onboardingService.startScraping(
      user.organizationId,
      body.companyUrl,
    );
  }

  @Put('progress')
  saveProgress(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Body() dto: SaveProgressDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to save onboarding progress',
      );
    }
    return this.onboardingService.saveProgress(user.organizationId, dto);
  }

  @Post('submit')
  submit(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Body() dto: SubmitOnboardingDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to submit onboarding',
      );
    }
    return this.onboardingService.submit(user.id, user.organizationId, dto);
  }

  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(
            new BadRequestException(
              `File type ${file.mimetype} is not allowed. Accepted types: PDF, DOC, DOCX, CSV, XLS, XLSX`,
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadDocument(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to upload documents',
      );
    }
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.onboardingService.uploadDocument(user.organizationId, file);
  }

  @Delete('documents/:id')
  deleteDocument(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to delete documents',
      );
    }
    return this.onboardingService.deleteDocument(
      documentId,
      user.organizationId,
    );
  }
}
