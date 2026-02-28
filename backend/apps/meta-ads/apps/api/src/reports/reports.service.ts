import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

function parseRange(since?: string, until?: string) {
  const end = until ? new Date(until) : new Date();
  const start = since ? new Date(since) : new Date(end);
  if (!since) {
    start.setDate(end.getDate() - 6);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary(orgId: string, since?: string, until?: string) {
    const adAccount = await this.prisma.adAccount.findFirst({ where: { orgId, isSelected: true } });
    if (!adAccount) {
      return { spend: 0, impressions: 0, clicks: 0, roas: 0, activeCampaigns: 0 };
    }
    const range = parseRange(since, until);
    const agg = await this.prisma.insightsDaily.aggregate({
      where: { orgId, adAccountId: adAccount.id, date: { gte: range.start, lte: range.end } },
      _sum: { spend: true, impressions: true, clicks: true },
      _avg: { roas: true },
    });
    const activeCampaigns = await this.prisma.campaign.count({
      where: { orgId, adAccountId: adAccount.id, status: 'ACTIVE' },
    });
    return {
      spend: agg._sum.spend ?? 0,
      impressions: agg._sum.impressions ?? 0,
      clicks: agg._sum.clicks ?? 0,
      roas: agg._avg.roas ?? 0,
      activeCampaigns,
    };
  }

  async trend(orgId: string, since?: string, until?: string) {
    const adAccount = await this.prisma.adAccount.findFirst({ where: { orgId, isSelected: true } });
    if (!adAccount) {
      return [];
    }
    const range = parseRange(since, until);
    const rows = await this.prisma.insightsDaily.groupBy({
      by: ['date'],
      where: { orgId, adAccountId: adAccount.id, date: { gte: range.start, lte: range.end } },
      _sum: { spend: true },
    });
    return rows
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((row) => ({ day: row.date.toISOString().slice(0, 10), spend: row._sum.spend ?? 0 }));
  }
}
