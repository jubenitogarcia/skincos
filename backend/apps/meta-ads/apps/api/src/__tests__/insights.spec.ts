import { normalizeInsightsRow } from '@meta/shared';

describe('normalizeInsightsRow', () => {
  it('normalizes spend and ids', () => {
    const row = {
      date_start: '2024-01-01',
      spend: '10.50',
      impressions: '100',
      clicks: '5',
      campaign_id: 'cmp_1',
      actions: [],
      purchase_roas: [{ value: '2.5' }],
    };
    const normalized = normalizeInsightsRow(row);
    expect(normalized.spend).toBe(10.5);
    expect(normalized.entityId).toBe('cmp_1');
    expect(normalized.roas).toBe(2.5);
  });
});
