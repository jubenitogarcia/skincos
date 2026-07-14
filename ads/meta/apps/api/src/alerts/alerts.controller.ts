import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AlertsService } from './alerts.service';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get()
  async list(@Req() req: any) {
    return this.alerts.list(req.user.orgId);
  }

  @Post(':id/resolve')
  async resolve(@Req() req: any, @Param('id') id: string) {
    return this.alerts.resolve(req.user.orgId, id);
  }
}
