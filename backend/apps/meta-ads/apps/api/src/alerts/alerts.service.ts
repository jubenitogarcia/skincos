import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.alert.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
  }

  resolve(orgId: string, id: string) {
    return this.prisma.alert.update({
      where: { id, orgId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }
}
