import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../queue/queue.service';
import { bulkActionSchema, budgetAdjustmentSchema, renameTemplateSchema } from '@meta/shared';

@Injectable()
export class BulkService {
  constructor(private prisma: PrismaService, private queue: QueueService) {}

  async preview(orgId: string, input: unknown) {
    const parsed = bulkActionSchema.parse(input);
    const items = await this.loadEntities(orgId, parsed.entityType, parsed.ids);
    const action = parsed.actionType;
    const previews = items.map((item) => {
      const before = { status: item.status, name: item.name, dailyBudget: item.dailyBudget };
      const after = { ...before } as any;
      let valid = true;
      let error: string | undefined;
      if (action === 'pause') {
        after.status = 'PAUSED';
      }
      if (action === 'resume') {
        after.status = 'ACTIVE';
      }
      if (action === 'budget') {
        const payload = budgetAdjustmentSchema.safeParse(parsed.payload);
        if (!payload.success) {
          valid = false;
          error = 'Payload inválido';
        } else if (!item.dailyBudget) {
          valid = false;
          error = 'Sem budget diário';
        } else {
          const current = item.dailyBudget;
          let updated = current;
          if (payload.data.mode === 'absolute') {
            updated = Math.round(payload.data.value * 100);
          } else {
            updated = Math.round(current * (1 + payload.data.value / 100));
          }
          if (payload.data.guardrailMin && updated < payload.data.guardrailMin * 100) {
            valid = false;
            error = 'Abaixo do guardrail mínimo';
          }
          if (payload.data.guardrailMax && updated > payload.data.guardrailMax * 100) {
            valid = false;
            error = 'Acima do guardrail máximo';
          }
          after.dailyBudget = updated;
        }
      }
      if (action === 'rename') {
        const payload = renameTemplateSchema.safeParse(parsed.payload);
        if (!payload.success) {
          valid = false;
          error = 'Payload inválido';
        } else {
          let name = item.name;
          if (payload.data.replace) {
            name = name.replace(payload.data.replace.search, payload.data.replace.replace);
          }
          if (payload.data.prefix) {
            name = `${payload.data.prefix}${name}`;
          }
          if (payload.data.suffix) {
            name = `${name}${payload.data.suffix}`;
          }
          after.name = name;
        }
      }
      if (action === 'duplicate') {
        const payload = renameTemplateSchema.safeParse(parsed.payload ?? {});
        let name = item.name;
        if (payload.success) {
          if (payload.data.prefix) {
            name = `${payload.data.prefix}${name}`;
          }
          if (payload.data.suffix) {
            name = `${name}${payload.data.suffix}`;
          }
        }
        after.name = name;
      }
      return {
        id: item.metaId,
        before,
        after,
        valid,
        error,
      };
    });
    return { count: previews.length, previews };
  }

  async execute(userId: string, orgId: string, input: unknown) {
    const parsed = bulkActionSchema.parse(input);
    const items = await this.loadEntities(orgId, parsed.entityType, parsed.ids);
    const operation = await this.prisma.bulkOperation.create({
      data: {
        orgId,
        userId,
        entityType: parsed.entityType.toUpperCase() as any,
        actionType: parsed.actionType.toUpperCase() as any,
        totalItems: items.length,
        payload: parsed.payload ?? {},
        items: {
          create: items.map((item) => ({
            metaId: item.metaId,
            before: { status: item.status, name: item.name, dailyBudget: item.dailyBudget },
          })),
        },
      },
      include: { items: true },
    });
    await this.queue.enqueueBulk(operation.id);
    return operation;
  }

  async list(orgId: string) {
    return this.prisma.bulkOperation.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async get(orgId: string, id: string) {
    return this.prisma.bulkOperation.findFirst({
      where: { orgId, id },
      include: { items: true },
    });
  }

  private async loadEntities(orgId: string, entityType: string, ids: string[]) {
    if (entityType === 'campaign') {
      return this.prisma.campaign.findMany({ where: { orgId, metaId: { in: ids } } });
    }
    if (entityType === 'adset') {
      return this.prisma.adSet.findMany({ where: { orgId, metaId: { in: ids } } });
    }
    return this.prisma.ad.findMany({ where: { orgId, metaId: { in: ids } } });
  }
}
