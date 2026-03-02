import { z } from "zod"

const numberLike = z.preprocess((value) => {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}, z.number().finite())

const summarySchema = z.object({
  spend: numberLike.default(0),
  impressions: numberLike.default(0),
  clicks: numberLike.default(0),
  roas: numberLike.default(0),
  revenue: numberLike.default(0),
})

const trendRowSchema = z.object({
  day: z.string().default(""),
  spend: numberLike.default(0),
  impressions: numberLike.default(0),
  clicks: numberLike.default(0),
  roas: numberLike.default(0),
  revenue: numberLike.default(0),
})

export const MetaMetricsSchema = z.object({
  platform: z.literal("meta-ads"),
  currency: z.string().default("USD"),
  period: z.object({
    since: z.string(),
    until: z.string(),
    timezone: z.string().default("UTC"),
  }),
  summary: summarySchema,
  trend: z.array(trendRowSchema).default([]),
})

export type MetaMetrics = z.infer<typeof MetaMetricsSchema>
