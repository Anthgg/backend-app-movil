const { validateCompleteProfilePayload } = require('../../src/services/onboarding-service/validators');

describe('Complete profile validator', () => {
  const companyId = '11111111-1111-4111-8111-111111111111';

  test('accepts entryDate as alias for startDate', () => {
    const errors = validateCompleteProfilePayload({
      laborData: {
        companyId,
        entryDate: '2026-06-01'
      }
    }, companyId);

    expect(errors).toEqual([]);
  });

  test('rejects invalid entryDate values', () => {
    const errors = validateCompleteProfilePayload({
      laborData: {
        companyId,
        entryDate: 'not-a-date'
      }
    }, companyId);

    expect(errors).toEqual([
      expect.objectContaining({ field: 'laborData.startDate' })
    ]);
  });
});
