import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  providers: [AlertsService, PrismaService],
  controllers: [AlertsController],
})
export class AlertsModule {}
