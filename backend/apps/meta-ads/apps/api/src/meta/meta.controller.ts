import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MetaService } from './meta.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { z } from 'zod';

const selectSchema = z.object({ adAccountId: z.string().min(1) });

@Controller('meta')
export class MetaController {
  constructor(private meta: MetaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('oauth/url')
  getOauthUrl(@Req() req: any) {
    return { url: this.meta.getOAuthUrl(req.user.orgId, req.user.sub) };
  }

  @Get('oauth/callback')
  async callback(@Query('code') code: string, @Query('state') state: string) {
    if (!code || !state) {
      throw new Error('Missing code or state');
    }
    return this.meta.handleOAuthCallback({ code, state });
  }

  @UseGuards(JwtAuthGuard)
  @Get('ad-accounts')
  async listAdAccounts(@Req() req: any) {
    return this.meta.syncAdAccounts(req.user.orgId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('ad-accounts/select')
  async selectAdAccount(@Req() req: any, @Body() body: unknown) {
    const input = selectSchema.parse(body);
    return this.meta.selectAdAccount(req.user.orgId, input.adAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('campaigns')
  async campaigns(@Req() req: any) {
    return this.meta.syncCampaigns(req.user.orgId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('insights/sync')
  async syncInsights(@Req() req: any, @Body() body: any) {
    const schema = z.object({ level: z.enum(['campaign', 'adset', 'ad']), since: z.string(), until: z.string() });
    const input = schema.parse(body);
    return this.meta.syncInsights(req.user.orgId, input.level, input.since, input.until);
  }
}
