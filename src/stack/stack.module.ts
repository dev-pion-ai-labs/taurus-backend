import { Module } from '@nestjs/common';
import { StackController } from './stack.controller';
import { StackService } from './stack.service';

@Module({
  controllers: [StackController],
  providers: [StackService],
  exports: [StackService],
})
export class StackModule {}
