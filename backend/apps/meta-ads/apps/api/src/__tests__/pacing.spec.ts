import { calculatePacing } from '@meta/shared';

describe('calculatePacing', () => {
  it('computes pacing ratio', () => {
    const { pacing, expectedSpend } = calculatePacing(120, 240, 12);
    expect(expectedSpend).toBeCloseTo(120, 2);
    expect(pacing).toBeCloseTo(1, 2);
  });
});
