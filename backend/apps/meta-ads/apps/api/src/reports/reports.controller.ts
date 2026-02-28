import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('summary')
  summary(@Req() req: any, @Query('since') since?: string, @Query('until') until?: string) {
    return this.reports.summary(req.user.orgId, since, until);
  }

  @Get('trend')
  trend(@Req() req: any, @Query('since') since?: string, @Query('until') until?: string) {
    return this.reports.trend(req.user.orgId, since, until);
  }
}
