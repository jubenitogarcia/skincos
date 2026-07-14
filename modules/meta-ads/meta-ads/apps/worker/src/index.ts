import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { prisma } from '@meta/db';
import { decryptToken, calculatePacing } from '@meta/shared';
import { batchUpdate, updateCampaign, updateAdSet, updateAd, copyCampaign, copyAdSet, copyAd } from '@meta/meta';
import { QUEUE_BULK, QUEUE_INSIGHTS, QUEUE_PACING } from '@meta/shared';

const logger = pino({ name: 'worker' });
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const mockMode = process.env.MOCK_MODE === 'true';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function processBulk(operationId: string) {
  const operation = await prisma.bulkOperation.findUnique({
    where: { id: operationId },
    include: { items: true, org: true },
  });
  if (!operation) {
    throw new Error('Operation not found');
  }
  await prisma.bulkOperation.update({ where: { id: operationId }, data: { status: 'RUNNING' } });

  const connectionRow = await prisma.metaConnection.findFirst({
    where: { orgId: operation.orgId },
    orderBy: { createdAt: 'desc' },
  });
  const accessToken = connectionRow ? decryptToken(connectionRow.accessTokenEncrypted) : 'mock-token';
  const entityType = operation.entityType;

  const action = operation.actionType;
  const chunks = chunk(operation.items, 25);

  let errorCount = 0;
  for (const group of chunks) {
    if (!mockMode) {
      try {
        if (action === 'PAUSE' || action === 'RESUME') {
          const payload = action === 'PAUSE' ? { status: 'PAUSED' } : { status: 'ACTIVE' };
          await batchUpdate(
            accessToken,
            group.map((item) => ({ id: item.metaId, payload })),
          );
          for (const item of group) {
            await prisma.bulkOperationItem.update({
              where: { id: item.id },
              data: { status: 'SUCCESS', after: { status: payload.status } },
            });
          }
        } else if (action === 'RENAME') {
          const template = operation.payload as any;
          for (const item of group) {
            const entity =
              entityType === 'ADSET'
                ? await prisma.adSet.findFirst({ where: { metaId: item.metaId } })
                : entityType === 'AD'
                  ? await prisma.ad.findFirst({ where: { metaId: item.metaId } })
                  : await prisma.campaign.findFirst({ where: { metaId: item.metaId } });
            const baseName = entity?.name ?? '';
            let name = baseName;
            if (template?.replace) {
              name = name.replace(template.replace.search, template.replace.replace);
            }
            if (template?.prefix) {
              name = `${template.prefix}${name}`;
            }
            if (template?.suffix) {
              name = `${name}${template.suffix}`;
            }
            if (entityType === 'ADSET') {
              await updateAdSet(accessToken, item.metaId, { name });
            } else if (entityType === 'AD') {
              await updateAd(accessToken, item.metaId, { name });
            } else {
              await updateCampaign(accessToken, item.metaId, { name });
            }
            await prisma.bulkOperationItem.update({
              where: { id: item.id },
              data: { status: 'SUCCESS', after: { name } },
            });
          }
        } else if (action === 'BUDGET') {
          const payload = operation.payload as any;
          for (const item of group) {
            if (entityType === 'AD') {
              errorCount += 1;
              await prisma.bulkOperationItem.update({
                where: { id: item.id },
                data: { status: 'ERROR', error: 'Budget não aplicável para Ads' },
              });
              continue;
            }
            const entity =
              entityType === 'ADSET'
                ? await prisma.adSet.findFirst({ where: { metaId: item.metaId } })
                : await prisma.campaign.findFirst({ where: { metaId: item.metaId } });
            if (!entity || !entity.dailyBudget) {
              errorCount += 1;
              await prisma.bulkOperationItem.update({
                where: { id: item.id },
                data: { status: 'ERROR', error: 'Sem budget diário' },
              });
              continue;
            }
            let updated = entity.dailyBudget;
            if (payload?.mode === 'absolute') {
              updated = Math.round(payload.value * 100);
            } else if (payload?.mode === 'percent') {
              updated = Math.round(entity.dailyBudget * (1 + payload.value / 100));
            }
            if (entityType === 'ADSET') {
              await updateAdSet(accessToken, item.metaId, { daily_budget: updated });
            } else {
              await updateCampaign(accessToken, item.metaId, { daily_budget: updated });
            }
            await prisma.bulkOperationItem.update({
              where: { id: item.id },
              data: { status: 'SUCCESS', after: { dailyBudget: updated } },
            });
          }
        }
        if (action === 'DUPLICATE') {
          const payload = operation.payload as any;
          const params: any = {};
          if (payload?.deepCopy) {
            params.deep_copy = true;
          }
          if (payload?.prefix || payload?.suffix) {
            params.rename_options = {
              rename_strategy: 'ONLY_TOP_LEVEL_RENAME',
              rename_prefix: payload.prefix || '',
              rename_suffix: payload.suffix || '',
            };
          }
          for (const item of group) {
            try {
              let result: any;
              if (entityType === 'ADSET') {
                result = await copyAdSet(accessToken, item.metaId, params);
              } else if (entityType === 'AD') {
                result = await copyAd(accessToken, item.metaId, params);
              } else {
                result = await copyCampaign(accessToken, item.metaId, params);
              }
              await prisma.bulkOperationItem.update({
                where: { id: item.id },
                data: { status: 'SUCCESS', after: { newId: result?.id ?? result?.id?.id ?? null } },
              });
            } catch (error: any) {
              errorCount += 1;
              await prisma.bulkOperationItem.update({
                where: { id: item.id },
                data: { status: 'ERROR', error: String(error?.message || error) },
              });
            }
          }
        }
      } catch (error: any) {
        errorCount += group.length;
        for (const item of group) {
          await prisma.bulkOperationItem.update({
            where: { id: item.id },
            data: { status: 'ERROR', error: String(error?.message || error) },
          });
        }
      }
    } else {
      for (const item of group) {
        const after =
          action === 'DUPLICATE'
            ? { newId: `mock_copy_${item.metaId}` }
            : { status: action };
        await prisma.bulkOperationItem.update({
          where: { id: item.id },
          data: { status: 'SUCCESS', after },
        });
      }
    }

    await prisma.bulkOperation.update({
      where: { id: operationId },
      data: { processedItems: { increment: group.length } },
    });
  }

  await prisma.bulkOperation.update({
    where: { id: operationId },
    data: { status: errorCount > 0 ? 'FAILED' : 'COMPLETED' },
  });
}

async function processInsights(job: any) {
  const { orgId, level, since, until } = job.data;
  logger.info({ orgId, level, since, until }, 'Insights job received');
  // Placeholder: Insights are synced in API for MVP.
}

async function processPacing(job: any) {
  const orgs = job.data?.orgId
    ? await prisma.org.findMany({ where: { id: job.data.orgId } })
    : await prisma.org.findMany();

  for (const org of orgs) {
    const adAccount = await prisma.adAccount.findFirst({ where: { orgId: org.id, isSelected: true } });
    if (!adAccount) continue;

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const spendRows = await prisma.insightsDaily.findMany({
      where: { orgId: org.id, adAccountId: adAccount.id, date: { gte: startOfDay, lt: endOfDay } },
    });
    const spendToday = spendRows.reduce((sum, row) => sum + (row.spend || 0), 0);

    const campaigns = await prisma.campaign.findMany({ where: { orgId: org.id, adAccountId: adAccount.id } });
    const dailyBudget = campaigns.reduce((sum, c) => sum + (c.dailyBudget || 0), 0) / 100;

    const hoursElapsed = now.getHours() + now.getMinutes() / 60;
    const { pacing, expectedSpend } = calculatePacing(spendToday, dailyBudget, hoursElapsed);

    const rule = await prisma.alertRule.findFirst({ where: { orgId: org.id, isActive: true, type: 'PACING_FAST' } });
    const pacingUpper = (rule?.config as any)?.pacingUpper ?? 1.3;

    if (pacingUpper > 0 && pacing > pacingUpper) {
      const existing = await prisma.alert.findFirst({
        where: { orgId: org.id, adAccountId: adAccount.id, type: 'PACING_FAST', status: 'OPEN' },
      });
      if (!existing) {
        await prisma.alert.create({
          data: {
            orgId: org.id,
            adAccountId: adAccount.id,
            type: 'PACING_FAST',
            message: `Pacing acima do limite (${pacing.toFixed(2)})`,
            data: { pacing, expectedSpend, spendToday },
          },
        });
      }
    }

    const noSpendRule = await prisma.alertRule.findFirst({ where: { orgId: org.id, isActive: true, type: 'NO_SPEND' } });
    const noSpendHours = (noSpendRule?.config as any)?.noSpendHours ?? 6;
    if (hoursElapsed >= noSpendHours && spendToday === 0) {
      const existing = await prisma.alert.findFirst({
        where: { orgId: org.id, adAccountId: adAccount.id, type: 'NO_SPEND', status: 'OPEN' },
      });
      if (!existing) {
        await prisma.alert.create({
          data: {
            orgId: org.id,
            adAccountId: adAccount.id,
            type: 'NO_SPEND',
            message: `Sem gasto detectado após ${noSpendHours} horas`,
            data: { noSpendHours },
          },
        });
      }
    }
  }
}

new Worker(
  QUEUE_BULK,
  async (job) => {
    const { operationId } = job.data;
    await processBulk(operationId);
  },
  { connection },
);

new Worker(QUEUE_INSIGHTS, processInsights, { connection });
new Worker(QUEUE_PACING, processPacing, { connection });

async function schedulePacing() {
  const pacingQueue = new Queue(QUEUE_PACING, { connection });
  const intervalMinutes = Number(process.env.PACING_INTERVAL_MINUTES || 60);
  await pacingQueue.add(
    'pacing-check',
    {},
    { jobId: 'pacing-check', repeat: { every: intervalMinutes * 60 * 1000 }, removeOnComplete: true },
  );
}

schedulePacing().catch((err) => logger.error(err));

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
});
