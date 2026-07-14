import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { encryptToken, decryptToken, normalizeInsightsRow } from '@meta/shared';
import { listAdAccounts, listCampaigns, getInsights } from '@meta/meta';
import { withRetries } from '../utils/retry';
import pino from 'pino';

const logger = pino({ name: 'MetaService' });

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  isMock() {
    return this.config.get<string>('MOCK_MODE') === 'true';
  }

  getOAuthUrl(orgId: string, userId: string) {
    const appId = this.config.get<string>('META_APP_ID');
    const redirectUri = this.config.get<string>('META_REDIRECT_URI');
    const scopes = this.config.get<string>('META_SCOPES') || 'ads_read,ads_management';
    if (!appId || !redirectUri) {
      throw new Error('META_APP_ID and META_REDIRECT_URI are required');
    }
    const state = Buffer.from(`${orgId}:${userId}`).toString('base64');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
  }

  async handleOAuthCallback(input: { code: string; state: string }) {
    const [orgId, userId] = Buffer.from(input.state, 'base64').toString('utf8').split(':');
    if (!orgId || !userId) {
      throw new Error('Invalid state');
    }
    if (this.isMock()) {
      const encrypted = encryptToken('mock-token');
      return this.prisma.metaConnection.create({
        data: {
          orgId,
          userId,
          accessTokenEncrypted: encrypted,
          scopes: ['mock'],
        },
      });
    }

    const appId = this.config.get<string>('META_APP_ID');
    const appSecret = this.config.get<string>('META_APP_SECRET');
    const redirectUri = this.config.get<string>('META_REDIRECT_URI');
    if (!appId || !appSecret || !redirectUri) {
      throw new Error('META_APP_ID, META_APP_SECRET and META_REDIRECT_URI are required');
    }
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code: input.code,
    });
    const response = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OAuth exchange failed: ${text}`);
    }
    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    const encrypted = encryptToken(data.access_token);
    return this.prisma.metaConnection.create({
      data: {
        orgId,
        userId,
        accessTokenEncrypted: encrypted,
        tokenType: data.token_type,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scopes: (this.config.get<string>('META_SCOPES') || '').split(',').filter(Boolean),
      },
    });
  }

  private async getAccessToken(orgId: string): Promise<string> {
    if (this.isMock()) {
      return 'mock-token';
    }
    const connection = await this.prisma.metaConnection.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    if (!connection) {
      throw new Error('Meta connection not found');
    }
    return decryptToken(connection.accessTokenEncrypted);
  }

  async listAdAccounts(orgId: string) {
    if (this.isMock()) {
      return [
        {
          id: 'act_123',
          name: 'Mock Account',
          currency: 'USD',
          account_status: 'ACTIVE',
          timezone_name: 'America/Sao_Paulo',
          permissions: ['ads_read', 'ads_management'],
        },
      ];
    }
    const token = await this.getAccessToken(orgId);
    return withRetries(() => listAdAccounts(token), { retries: 3, baseDelayMs: 500, factor: 2 });
  }

  async syncAdAccounts(orgId: string) {
    const accounts = await this.listAdAccounts(orgId);
    for (const acc of accounts as any[]) {
      await this.prisma.adAccount.upsert({
        where: { orgId_metaAccountId: { orgId, metaAccountId: acc.id } },
        update: {
          name: acc.name,
          currency: acc.currency,
          timezone: acc.timezone_name,
          status: String(acc.account_status ?? ''),
          permissions: acc.permissions ?? [],
        },
        create: {
          orgId,
          metaAccountId: acc.id,
          name: acc.name,
          currency: acc.currency,
          timezone: acc.timezone_name,
          status: String(acc.account_status ?? ''),
          permissions: acc.permissions ?? [],
        },
      });
    }
    return this.prisma.adAccount.findMany({ where: { orgId } });
  }

  async selectAdAccount(orgId: string, adAccountId: string) {
    await this.prisma.adAccount.updateMany({ where: { orgId }, data: { isSelected: false } });
    const updated = await this.prisma.adAccount.update({
      where: { id: adAccountId },
      data: { isSelected: true },
    });
    await this.prisma.org.update({ where: { id: orgId }, data: { defaultAdAccountId: adAccountId } });
    return updated;
  }

  async syncCampaigns(orgId: string) {
    const adAccount = await this.prisma.adAccount.findFirst({ where: { orgId, isSelected: true } });
    if (!adAccount) {
      throw new Error('No ad account selected');
    }
    let campaigns: any[] = [];
    if (this.isMock()) {
      campaigns = [
        {
          id: 'cmp_1',
          name: 'Mock Campaign A',
          status: 'ACTIVE',
          objective: 'CONVERSIONS',
          daily_budget: '5000',
        },
        {
          id: 'cmp_2',
          name: 'Mock Campaign B',
          status: 'PAUSED',
          objective: 'AWARENESS',
          daily_budget: '2000',
        },
      ];
    } else {
      const token = await this.getAccessToken(orgId);
      campaigns = await withRetries(
        () => listCampaigns(token, adAccount.metaAccountId),
        { retries: 3, baseDelayMs: 500, factor: 2 },
      );
    }

    for (const campaign of campaigns) {
      await this.prisma.campaign.upsert({
        where: { orgId_metaId: { orgId, metaId: campaign.id } },
        update: {
          name: campaign.name,
          status: campaign.status,
          objective: campaign.objective,
          dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) : null,
          lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) : null,
          adAccountId: adAccount.id,
        },
        create: {
          orgId,
          adAccountId: adAccount.id,
          metaId: campaign.id,
          name: campaign.name,
          status: campaign.status,
          objective: campaign.objective,
          dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) : null,
          lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) : null,
        },
      });
    }
    return this.prisma.campaign.findMany({ where: { orgId } });
  }

  async syncInsights(orgId: string, level: 'campaign' | 'adset' | 'ad', since: string, until: string) {
    const adAccount = await this.prisma.adAccount.findFirst({ where: { orgId, isSelected: true } });
    if (!adAccount) {
      throw new Error('No ad account selected');
    }
    const token = await this.getAccessToken(orgId);
    const insights = this.isMock()
      ? [
          {
            date_start: since,
            date_stop: until,
            spend: '123.45',
            impressions: '1000',
            clicks: '50',
            actions: [],
            purchase_roas: [],
          },
        ]
      : await withRetries(() => getInsights(token, adAccount.metaAccountId, { level, since, until }), {
          retries: 3,
          baseDelayMs: 500,
          factor: 2,
        });

    for (const row of insights as any[]) {
      const normalized = normalizeInsightsRow(row);
      const date = normalized.date;
      const spend = normalized.spend;
      const impressions = normalized.impressions;
      const clicks = normalized.clicks;
      const roas = normalized.roas;
      const entityId = normalized.entityId;
      await this.prisma.insightsDaily.upsert({
        where: { orgId_level_entityId_date: { orgId, level: level.toUpperCase() as any, entityId, date } },
        update: { spend, impressions, clicks, actions: normalized.actions ?? [], roas },
        create: {
          orgId,
          adAccountId: adAccount.id,
          level: level.toUpperCase() as any,
          entityId,
          date,
          spend,
          impressions,
          clicks,
          actions: normalized.actions ?? [],
          roas,
        },
      });
    }

    logger.info({ level, count: insights.length }, 'Insights synced');
    return insights.length;
  }
}
