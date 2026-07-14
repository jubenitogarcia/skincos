import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_BULK, QUEUE_INSIGHTS, QUEUE_PACING } from '@meta/shared';

@Injectable()
export class QueueService {
  private connection: IORedis;
  private bulkQueue: Queue;
  private insightsQueue: Queue;
  private pacingQueue: Queue;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.bulkQueue = new Queue(QUEUE_BULK, { connection: this.connection });
    this.insightsQueue = new Queue(QUEUE_INSIGHTS, { connection: this.connection });
    this.pacingQueue = new Queue(QUEUE_PACING, { connection: this.connection });
  }

  async enqueueBulk(operationId: string) {
    return this.bulkQueue.add('bulk-operation', { operationId });
  }

  async enqueueInsights(orgId: string, level: string, since: string, until: string) {
    return this.insightsQueue.add('sync-insights', { orgId, level, since, until });
  }

  async enqueuePacing(orgId: string) {
    return this.pacingQueue.add('pacing-check', { orgId });
  }
}
