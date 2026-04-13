import { Module } from '@nestjs/common';
import { StackController } from './stack.controller';
import { StackService } from './stack.service';
import { AiModule } from '../ai';

@Module({
  imports: [AiModule],
  controllers: [StackController],
  providers: [StackService],
  exports: [StackService],
})
export class StackModule {}
