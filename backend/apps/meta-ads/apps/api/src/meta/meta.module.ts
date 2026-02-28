import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetaService } from './meta.service';
import { MetaController } from './meta.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [ConfigModule],
  providers: [MetaService, PrismaService],
  controllers: [MetaController],
  exports: [MetaService],
})
export class MetaModule {}
