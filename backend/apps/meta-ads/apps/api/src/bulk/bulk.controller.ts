import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BulkService } from './bulk.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('bulk')
@UseGuards(JwtAuthGuard)
export class BulkController {
  constructor(private bulk: BulkService) {}

  @Post('preview')
  async preview(@Req() req: any, @Body() body: unknown) {
    return this.bulk.preview(req.user.orgId, body);
  }

  @Post('execute')
  async execute(@Req() req: any, @Body() body: unknown) {
    return this.bulk.execute(req.user.sub, req.user.orgId, body);
  }

  @Get('operations')
  async list(@Req() req: any) {
    return this.bulk.list(req.user.orgId);
  }

  @Get('operations/:id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.bulk.get(req.user.orgId, id);
  }
}
