import { provideHttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';
import { CabinetDashboardApi } from './cabinet-dashboard.api';

const baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

const response = {
  generatedAt: '2026-07-26T18:30:00.000Z',
  asOfDate: '2026-07-26',
  scope: 'CABINET',
  cabinet: { cabinetOrgId: 'org-cabinet', displayName: 'Cabinet Conseil' },
  portfolio: { accessibleDossiers: 12, activeDossiers: 10 },
  team: {
    activeMembers: 8,
    administrators: 1,
    supervisors: 2,
    collaborators: 4,
    readers: 1,
    pendingInvitations: 2
  },
  work: {
    totalActive: 20,
    toPlan: 2,
    toDo: 7,
    inProgress: 6,
    waiting: 5,
    overdue: 12,
    dueSoon: 3,
    unassigned: 1
  },
  deadlines: {
    pending: 11,
    overdue: 4,
    dueToday: 1,
    next7Days: 3,
    next30Days: 7
  },
  attention: {
    overdueWorks: [],
    overdueDeadlines: [],
    upcomingDeadlines: []
  }
};

describe('CabinetDashboardApi', () => {
  let api: CabinetDashboardApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CabinetDashboardApi, provideHttpClient(), provideHttpClientTesting()]
    });
    api = TestBed.inject(CabinetDashboardApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the cabinet dashboard in Cabinet tenant scope and validates the response', async () => {
    const promise = api.getCabinetDashboard();
    const request = http.expectOne(`${baseUrl}/cabinet/dashboard`);

    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(TENANT_REQUEST_SCOPE)).toBe('CABINET');
    expect(request.request.params.keys()).toEqual([]);

    request.flush(response);

    await expect(promise).resolves.toMatchObject({
      cabinet: { cabinetOrgId: 'org-cabinet' },
      work: { overdue: 12 },
      deadlines: { overdue: 4 }
    });
  });

  it('rejects invalid dashboard payloads instead of casting unknown JSON', async () => {
    const promise = api.getCabinetDashboard();
    http.expectOne(`${baseUrl}/cabinet/dashboard`).flush({ ...response, scope: 'CABINET_ADMIN' });

    await expect(promise).rejects.toBeTruthy();
  });

  it('preserves aggregation-limit backend errors for UI mapping', async () => {
    const promise = api.getCabinetDashboard();
    http.expectOne(`${baseUrl}/cabinet/dashboard`).flush(
      {
        message: {
          code: 'CABINET_DASHBOARD_AGGREGATION_LIMIT_EXCEEDED',
          message: 'Too much data'
        }
      },
      { status: 422, statusText: 'Unprocessable Entity' }
    );

    await expect(promise).rejects.toMatchObject({
      error: {
        message: {
          code: 'CABINET_DASHBOARD_AGGREGATION_LIMIT_EXCEEDED'
        }
      }
    } satisfies Partial<HttpErrorResponse>);
  });
});
