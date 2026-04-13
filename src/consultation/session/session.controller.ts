import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { ReportService } from './report.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { JwtAuthGuard, CurrentUser, PaginationQueryDto } from '../../common';
import type { Response } from 'express';

@ApiTags('Consultation Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultation/sessions')
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private reportService: ReportService,
  ) {}

  @Post()
  start(@CurrentUser() user: { id: string; organizationId: string }) {
    return this.sessionService.startSession(user.id, user.organizationId);
  }

  @Get()
  list(
    @CurrentUser('organizationId') orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.sessionService.listSessions(orgId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.sessionService.getSessionWithReport(id, userId);
  }

  @Get(':id/current-question')
  currentQuestion(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.sessionService.getCurrentQuestion(id, userId);
  }

  @Post(':id/answers')
  submitAnswer(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.sessionService.submitAnswer(id, userId, dto.questionId, dto.value);
  }

  @Patch(':id/abandon')
  abandon(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.sessionService.abandonSession(id, userId);
  }

  // ── Report Endpoints ──────────────────────────────────────

  @Get(':id/report')
  getReport(
    @Param('id') sessionId: string,
    @CurrentUser('organizationId') orgId: string,
  ) {
    return this.reportService.getReport(sessionId, orgId);
  }

  @Post(':id/report/regenerate')
  regenerateReport(
    @Param('id') sessionId: string,
    @CurrentUser() user: { id: string; organizationId: string },
  ) {
    return this.reportService.regenerateReport(
      sessionId,
      user.id,
      user.organizationId,
    );
  }

  @Get(':id/report/export')
  async exportReportPdf(
    @Param('id') sessionId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.reportService.exportReportPdf(
      sessionId,
      orgId,
    );

    const dateStr = new Date().toISOString().split('T')[0];
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="taurus-report-${dateStr}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }
}
