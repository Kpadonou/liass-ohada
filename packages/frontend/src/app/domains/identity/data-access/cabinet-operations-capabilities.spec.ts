import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AccountingWork,
  CabinetDeadline,
  CabinetDossierSummary,
  CabinetRole
} from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';
import { CabinetOperationsCapabilities } from './cabinet-operations-capabilities';

const now = '2026-07-20T00:00:00.000Z';

function work(overrides: Partial<AccountingWork> = {}): AccountingWork {
  return {
    cabinetOrgId: 'cabinet-1',
    createdAt: now,
    createdBy: 'admin-1',
    dossierOrgId: 'dossier-1',
    participantUserIds: [],
    priority: 'NORMAL',
    status: 'TO_DO',
    title: 'July close',
    type: 'MONTHLY_CLOSE',
    updatedAt: now,
    updatedBy: 'admin-1',
    workId: 'work-1',
    ...overrides
  };
}

function deadline(overrides: Partial<CabinetDeadline> = {}): CabinetDeadline {
  return {
    cabinetOrgId: 'cabinet-1',
    createdAt: now,
    createdBy: 'admin-1',
    deadlineId: 'deadline-1',
    dossierOrgId: 'dossier-1',
    dueDate: '2026-07-31',
    priority: 'NORMAL',
    status: 'PENDING',
    title: 'Tax filing',
    type: 'TAX',
    updatedAt: now,
    updatedBy: 'admin-1',
    ...overrides
  };
}

describe('CabinetOperationsCapabilities', () => {
  const role = signal<CabinetRole | null>('CABINET_ADMIN');
  const currentUserId = signal<string | null>('actor-1');
  const dossiers = signal<CabinetDossierSummary[]>([
    {
      accountingFramework: 'SYSCOHADA_REVISED',
      accessMode: 'READ_WRITE',
      country: 'BJ',
      createdAt: now,
      displayName: 'Client A',
      orgId: 'dossier-1',
      status: 'ACTIVE',
      updatedAt: now
    }
  ]);

  beforeEach(() => {
    role.set('CABINET_ADMIN');
    currentUserId.set('actor-1');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: {
            activeCabinetRole: role,
            activeWorkspaceType: () => 'ACCOUNTING_FIRM',
            currentUserId,
            dossiers
          }
        }
      ]
    });
  });

  it('grants administrators full non-final Work and Deadline management', () => {
    const capabilities = TestBed.inject(CabinetOperationsCapabilities);
    expect(capabilities.canViewCabinetWork()).toBe(true);
    expect(capabilities.canCreateCabinetWork()).toBe(true);
    expect(capabilities.canEditCabinetWork(work())).toBe(true);
    expect(capabilities.canChangeCabinetWorkStatus(work(), 'CANCELLED')).toBe(true);
    expect(capabilities.canCreateCabinetDeadline()).toBe(true);
    expect(capabilities.canEditCabinetDeadline(deadline())).toBe(true);
    expect(capabilities.canChangeCabinetDeadlineStatus(deadline(), 'CANCELLED')).toBe(true);
  });

  it('limits supervisors to assigned active dossiers', () => {
    role.set('SUPERVISOR');
    const capabilities = TestBed.inject(CabinetOperationsCapabilities);
    expect(capabilities.canCreateCabinetWork()).toBe(true);
    expect(capabilities.canEditCabinetWork(work())).toBe(true);
    expect(capabilities.canEditCabinetWork(work({ dossierOrgId: 'other-dossier' }))).toBe(false);
    expect(capabilities.canChangeCabinetDeadlineStatus(deadline(), 'COMPLETED')).toBe(true);
    expect(
      capabilities.canChangeCabinetDeadlineStatus(deadline({ dossierOrgId: 'other-dossier' }), 'COMPLETED')
    ).toBe(false);
  });

  it('allows collaborators to update only eligible Work status and responsible Deadlines', () => {
    role.set('COLLABORATOR');
    const capabilities = TestBed.inject(CabinetOperationsCapabilities);
    expect(capabilities.canCreateCabinetWork()).toBe(false);
    expect(capabilities.canEditCabinetWork(work({ responsibleUserId: 'actor-1' }))).toBe(false);
    expect(capabilities.canChangeCabinetWorkStatus(work({ responsibleUserId: 'actor-1' }), 'IN_PROGRESS')).toBe(true);
    expect(capabilities.canChangeCabinetWorkStatus(work({ participantUserIds: ['actor-1'] }), 'COMPLETED')).toBe(true);
    expect(capabilities.canChangeCabinetWorkStatus(work({ responsibleUserId: 'other' }), 'IN_PROGRESS')).toBe(false);
    expect(capabilities.canChangeCabinetWorkStatus(work({ responsibleUserId: 'actor-1' }), 'CANCELLED')).toBe(false);
    expect(capabilities.canChangeCabinetDeadlineStatus(deadline({ responsibleUserId: 'actor-1' }), 'COMPLETED')).toBe(true);
    expect(capabilities.canChangeCabinetDeadlineStatus(deadline({ responsibleUserId: 'actor-1' }), 'CANCELLED')).toBe(false);
  });

  it('keeps readers read-only and final states immutable', () => {
    role.set('READER');
    const capabilities = TestBed.inject(CabinetOperationsCapabilities);
    expect(capabilities.canViewCabinetWork()).toBe(true);
    expect(capabilities.canCreateCabinetWork()).toBe(false);
    expect(capabilities.canEditCabinetWork(work())).toBe(false);
    role.set('CABINET_ADMIN');
    expect(capabilities.canEditCabinetWork(work({ status: 'COMPLETED' }))).toBe(false);
    expect(capabilities.canEditCabinetDeadline(deadline({ status: 'CANCELLED' }))).toBe(false);
  });
});
