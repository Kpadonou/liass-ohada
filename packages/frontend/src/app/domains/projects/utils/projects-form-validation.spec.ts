import {
  CreateBudgetLineRequestSchema,
  CreateDonorRequestSchema,
  CreateFundingSourceRequestSchema,
  CreateProjectRequestSchema
} from '@liass-ohada/shared/projects';

describe('projects form validation schemas', () => {
  it('validates project creation payloads', () => {
    expect(() =>
      CreateProjectRequestSchema.parse({
        projectCode: 'EDU-1',
        name: 'Education project',
        donorId: 'UNICEF',
        managerId: 'manager-1',
        startDate: '2026-01-01',
        totalBudget: 1000000,
        annualBudgets: { '2026': 1000000 },
        currency: 'XOF',
        status: 'ACTIVE'
      })
    ).not.toThrow();

    expect(() =>
      CreateProjectRequestSchema.parse({
        projectCode: 'EDU-1',
        name: 'Education project',
        donorId: 'UNICEF',
        managerId: 'manager-1',
        startDate: '01-01-2026',
        totalBudget: 1000000
      })
    ).toThrow();
  });

  it('validates donor, funding source, and budget line payloads', () => {
    expect(() =>
      CreateDonorRequestSchema.parse({
        code: 'AFD',
        name: 'Agence Française de Développement',
        type: 'PUBLIC',
        currency: 'XOF'
      })
    ).not.toThrow();

    expect(() =>
      CreateFundingSourceRequestSchema.parse({
        donorId: 'AFD',
        label: 'Convention AFD 2026',
        amount: 500000,
        currency: 'XOF'
      })
    ).not.toThrow();

    expect(() =>
      CreateBudgetLineRequestSchema.parse({
        fiscalYear: '2026',
        code: 'ACT-1',
        label: 'Activities',
        amount: 500000,
        category: 'ACTIVITY'
      })
    ).not.toThrow();

    expect(() =>
      CreateBudgetLineRequestSchema.parse({
        fiscalYear: '26',
        code: 'ACT-1',
        label: 'Activities',
        amount: -1,
        category: 'ACTIVITY'
      })
    ).toThrow();
  });
});
