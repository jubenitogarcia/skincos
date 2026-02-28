import { z } from 'zod';

export const dateRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

export const bulkActionSchema = z.object({
  entityType: z.enum(['campaign', 'adset', 'ad']),
  actionType: z.enum(['pause', 'resume', 'budget', 'rename', 'duplicate']),
  ids: z.array(z.string().min(1)).min(1),
  payload: z.record(z.any()).optional(),
});

export const budgetAdjustmentSchema = z.object({
  mode: z.enum(['absolute', 'percent']),
  value: z.number(),
  guardrailMin: z.number().optional(),
  guardrailMax: z.number().optional(),
});

export const renameTemplateSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  replace: z
    .object({
      search: z.string(),
      replace: z.string(),
    })
    .optional(),
});

export const pacingRuleSchema = z.object({
  pacingUpper: z.number(),
  noSpendHours: z.number(),
});

export type BulkActionInput = z.infer<typeof bulkActionSchema>;
