import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { ProjectsApi } from './projects.api';

describe('ProjectsApi', () => {
  let api: ProjectsApi;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProjectsApi, provideHttpClient(), provideHttpClientTesting()]
    });

    api = TestBed.inject(ProjectsApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('validates and maps project list responses without DynamoDB keys', async () => {
    const promise = api.listProjects();
    const request = httpMock.expectOne(`${apiBaseUrl}/projects`);

    request.flush({
      data: {
        projects: [
          {
            orgId: 'test-org',
            projectId: 'PRJ-1',
            projectCode: 'EDU-1',
            name: 'Education project',
            donorId: 'UNICEF',
            managerId: 'manager-1',
            startDate: '2026-01-01',
            totalBudget: 1000000,
            annualBudgets: { '2026': 1000000 },
            currency: 'XOF',
            currentSpending: 0,
            status: 'ACTIVE',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            PK: 'ORG#test-org'
          }
        ]
      }
    });

    await expect(promise).resolves.toEqual([
      {
        orgId: 'test-org',
        projectId: 'PRJ-1',
        projectCode: 'EDU-1',
        name: 'Education project',
        donorId: 'UNICEF',
        managerId: 'manager-1',
        startDate: '2026-01-01',
        totalBudget: 1000000,
        annualBudgets: { '2026': 1000000 },
        currency: 'XOF',
        currentSpending: 0,
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      }
    ]);
  });

  it('rejects invalid donor list responses', async () => {
    const promise = api.listDonors();
    const request = httpMock.expectOne(`${apiBaseUrl}/donors`);

    request.flush({ data: { donors: [{ donorId: 'UNICEF' }] } });

    await expect(promise).rejects.toThrow();
  });

  it('creates budget lines with the selected year and project id', async () => {
    const promise = api.createBudgetLine('PRJ-1', {
      fiscalYear: '2026',
      code: 'ACT-1',
      label: 'Activity',
      amount: 500000,
      category: 'ACTIVITY'
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/projects/PRJ-1/budget-lines`);

    expect(request.request.method).toBe('POST');
    request.flush({
      data: {
        projectId: 'PRJ-1',
        fiscalYear: '2026',
        code: 'ACT-1',
        label: 'Activity',
        amount: 500000,
        category: 'ACTIVITY'
      }
    });

    await expect(promise).resolves.toEqual({
      projectId: 'PRJ-1',
      fiscalYear: '2026',
      code: 'ACT-1',
      label: 'Activity',
      amount: 500000,
      category: 'ACTIVITY'
    });
  });
});
