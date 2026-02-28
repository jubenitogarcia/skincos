import { Module } from '@nestjs/common';
import { BulkService } from './bulk.service';
import { BulkController } from './bulk.controller';
import { PrismaService } from '../common/prisma.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [BulkService, PrismaService],
  controllers: [BulkController],
})
export class BulkModule {}
