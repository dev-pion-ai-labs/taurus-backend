import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import {
  JwtAuthGuard,
  CurrentUser,
  PaginationQueryDto,
} from '../../common';

@ApiTags('Consultation Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultation/sessions')
export class SessionController {
  constructor(private sessionService: SessionService) {}

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
  findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessionService.getSession(id, userId);
  }

  @Get(':id/current-question')
  currentQuestion(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
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
  abandon(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessionService.abandonSession(id, userId);
  }
}
