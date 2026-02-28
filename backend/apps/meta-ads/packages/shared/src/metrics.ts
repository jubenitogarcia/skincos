export function calculatePacing(spendToday: number, dailyBudget: number, hoursElapsed: number) {
  const expectedSpend = dailyBudget * (hoursElapsed / 24);
  const pacing = expectedSpend > 0 ? spendToday / expectedSpend : 0;
  return { pacing, expectedSpend };
}

export function normalizeInsightsRow(row: any) {
  return {
    date: new Date(row.date_start),
    spend: row.spend ? Number(row.spend) : 0,
    impressions: row.impressions ? Number(row.impressions) : 0,
    clicks: row.clicks ? Number(row.clicks) : 0,
    roas: row.purchase_roas?.[0]?.value ? Number(row.purchase_roas[0].value) : 0,
    actions: row.actions ?? [],
    entityId: row.campaign_id || row.adset_id || row.ad_id || 'unknown',
  };
}
