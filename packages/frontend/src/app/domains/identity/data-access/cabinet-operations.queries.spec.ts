import { TestBed } from '@angular/core/testing';

import { AuthStore } from './auth.store';
import { CabinetOperationsApi } from './cabinet-operations.api';
import { CabinetOperationsCapabilities } from './cabinet-operations-capabilities';
import { CabinetOperationsQueries } from './cabinet-operations.queries';

describe('CabinetOperationsQueries', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CabinetOperationsApi, useValue: {} },
        {
          provide: CabinetOperationsCapabilities,
          useValue: {
            canViewCabinetDeadlines: () => true,
            canViewCabinetWork: () => true
          }
        },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: () => 'org-cabinet'
          }
        }
      ]
    });
  });

  it('creates cabinet-tenant-aware Work query keys with backend filters', () => {
    const queries = TestBed.inject(CabinetOperationsQueries);
    expect(
      queries.works({
        cursor: 'cursor-1',
        dossierOrgId: 'dossier-1',
        dueFrom: '2026-07-01',
        dueTo: '2026-07-31',
        limit: 25,
        priority: 'HIGH',
        responsibleUserId: 'user-1',
        status: 'IN_PROGRESS',
        type: 'MONTHLY_CLOSE'
      }).queryKey
    ).toEqual([
      'cabinet-operations',
      'org-cabinet',
      'works',
      {
        cursor: 'cursor-1',
        dossierOrgId: 'dossier-1',
        dueFrom: '2026-07-01',
        dueTo: '2026-07-31',
        limit: 25,
        periodEnd: null,
        periodStart: null,
        priority: 'HIGH',
        responsibleUserId: 'user-1',
        status: 'IN_PROGRESS',
        type: 'MONTHLY_CLOSE'
      }
    ]);
  });

  it('creates cabinet-tenant-aware Deadline query keys with cursor and overdue state', () => {
    const queries = TestBed.inject(CabinetOperationsQueries);
    expect(
      queries.deadlines({
        cursor: 'cursor-2',
        dossierOrgId: 'dossier-2',
        dueFrom: '2026-08-01',
        limit: 50,
        overdue: true,
        priority: 'URGENT',
        responsibleUserId: 'user-2',
        status: 'PENDING',
        type: 'TAX'
      }).queryKey
    ).toEqual([
      'cabinet-operations',
      'org-cabinet',
      'deadlines',
      {
        cursor: 'cursor-2',
        dossierOrgId: 'dossier-2',
        dueFrom: '2026-08-01',
        dueTo: null,
        limit: 50,
        overdue: true,
        priority: 'URGENT',
        responsibleUserId: 'user-2',
        status: 'PENDING',
        type: 'TAX'
      }
    ]);
  });
});
