import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'template-generation' })],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
