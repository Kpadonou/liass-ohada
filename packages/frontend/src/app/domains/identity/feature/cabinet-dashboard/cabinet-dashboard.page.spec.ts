import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { CabinetDashboardResponse, CabinetRole } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardApi } from '../../data-access/cabinet-dashboard.api';
import { CabinetDashboardPage } from './cabinet-dashboard.page';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

const translations = {
  en: {
    IDENTITY: {
      CABINET_DASHBOARD: {
        ACTIONS: {
          NEW_DEADLINE: 'New deadline',
          NEW_WORK: 'New work',
          RETRY: 'Retry',
          VIEW_DEADLINES: 'View deadlines',
          VIEW_DOSSIERS: 'View dossiers',
          VIEW_TEAM: 'View team',
          VIEW_WORK: 'View work'
        },
        ATTENTION: {
          BOUNDED_DEADLINES: 'Bounded deadline preview',
          BOUNDED_WORK: 'Bounded work preview',
          DEADLINE_TITLE: '{{ count }} overdue deadlines',
          NO_OVERDUE_DEADLINES: 'No overdue deadline',
          NO_OVERDUE_WORK: 'No overdue work',
          TITLE: 'Needs attention',
          WORK_TITLE: '{{ count }} overdue work items',
          ZERO_DESCRIPTION: 'Upcoming items appear below.',
          ZERO_TITLE: 'Nothing overdue.'
        },
        DATE: { TODAY: 'Today', TOMORROW: 'Tomorrow' },
        DEADLINES: {
          DAYS_8_30: 'Days 8-30',
          DESCRIPTION: 'Deadline buckets',
          NEXT_7_DAYS: 'Next 7 days',
          OVERDUE: 'Overdue',
          TITLE: 'Deadlines',
          TODAY: 'Today'
        },
        EMPTY: {
          CABINET_DESCRIPTION: 'Create or add a dossier.',
          CABINET_TITLE: 'Your cabinet workspace is ready.',
          SCOPED_DESCRIPTION: 'Assignments will appear here.',
          SCOPED_TITLE: 'No dossier is currently assigned to you.'
        },
        ERRORS: {
          AGGREGATION_LIMIT_DESCRIPTION: 'Modules remain accessible.',
          AGGREGATION_LIMIT_TITLE: 'Too much data.',
          LOAD_DESCRIPTION: 'Retry later.',
          LOAD_TITLE: 'Dashboard could not be loaded.'
        },
        EYEBROW: 'Cabinet',
        METRICS: {
          ACCESSIBLE_DOSSIERS: 'Accessible dossiers',
          ACTIVE_DOSSIERS: 'Active dossiers',
          ACTIVE_WORK: 'Active work',
          MY_ACTIVE_WORK: 'My active work',
          MY_OVERDUE_DEADLINES: 'My overdue deadlines',
          MY_OVERDUE_WORK: 'My overdue work',
          OVERDUE_DEADLINES: 'Overdue deadlines',
          OVERDUE_WORK: 'Overdue work',
          SUPERVISED_DOSSIERS: 'Supervised dossiers'
        },
        METRICS_META: {
          ACCESSIBLE_DOSSIERS: 'Accessible scope',
          ACTIVE_DOSSIERS: 'Cabinet portfolio',
          ACTIVE_WORK: 'Open work',
          MY_ACTIVE_WORK: 'Open personal work',
          MY_OVERDUE_DEADLINES: 'Personal overdue deadlines',
          MY_OVERDUE_WORK: 'Personal overdue work',
          OVERDUE_DEADLINES: 'Past due deadlines',
          OVERDUE_WORK: 'Past due work',
          SUPERVISED_DOSSIERS: 'Supervised scope'
        },
        PORTFOLIO: {
          ACCESSIBLE: 'Accessible dossiers',
          ACTIVE: 'Active dossiers',
          DESCRIPTION: 'Portfolio totals',
          TITLE_CABINET: 'Client portfolio',
          TITLE_SCOPED: 'Dossier access'
        },
        SCOPE: {
          ASSIGNED_DOSSIERS_READ_ONLY: 'My accessible dossiers',
          CABINET: 'Cabinet view',
          PERSONAL_ACTIVITY: 'My activity',
          SUPERVISED_DOSSIERS: 'My supervised dossiers'
        },
        SNAPSHOT: 'As of {{ date }} refreshed at {{ time }}',
        SUBTITLE: {
          ASSIGNED_DOSSIERS_READ_ONLY: 'Review accessible dossiers.',
          CABINET: "Overview of the Cabinet's activity and priorities.",
          PERSONAL_ACTIVITY: 'Track your work, deadlines, and attention items.',
          SUPERVISED_DOSSIERS: 'Track supervised dossiers.'
        },
        TEAM: {
          ACTIVE_MEMBERS: 'Active members',
          ADMINISTRATORS: 'Administrators',
          COLLABORATORS: 'Collaborators',
          DESCRIPTION: 'Team totals',
          PENDING_INVITATIONS: 'Pending invitations',
          READERS: 'Readers',
          SUPERVISORS: 'Supervisors',
          TITLE: 'Team'
        },
        TITLE: 'Dashboard',
        UPCOMING: {
          DESCRIPTION: 'Upcoming preview',
          EMPTY: 'No upcoming deadlines',
          TITLE: 'Upcoming deadlines'
        },
        WORK: {
          DESCRIPTION: 'Work status totals',
          IN_PROGRESS: 'In progress',
          TITLE: 'Accounting work',
          TO_DO: 'To do',
          TO_PLAN: 'To plan',
          UNASSIGNED: 'Unassigned',
          WAITING: 'Waiting'
        }
      },
      CABINET_OPERATIONS: {
        DEADLINE: { TYPES: { TAX: 'Tax' } },
        PRIORITY: { HIGH: 'High', NORMAL: 'Normal', URGENT: 'Urgent' },
        UNASSIGNED: 'Unassigned',
        UNKNOWN_DOSSIER: 'Client dossier',
        WORK: { TYPES: { ACCOUNT_REVIEW: 'Account review' } }
      }
    }
  }
};

const baseDashboard: CabinetDashboardResponse = {
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
    overdueWorks: [
      {
        workId: 'work-1',
        dossierOrgId: 'org-client',
        dossierName: 'Dona Shop',
        title: 'Review receivables',
        type: 'ACCOUNT_REVIEW',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        responsibleDisplayName: 'Awa Mensah',
        dueDate: '2026-07-25'
      }
    ],
    overdueDeadlines: [
      {
        deadlineId: 'deadline-1',
        dossierOrgId: 'org-client',
        dossierName: 'Dona Shop',
        title: 'Tax return',
        type: 'TAX',
        priority: 'URGENT',
        status: 'PENDING',
        responsibleDisplayName: 'Chris',
        dueDate: '2026-07-24'
      }
    ],
    upcomingDeadlines: [
      {
        deadlineId: 'deadline-2',
        dossierOrgId: 'org-client',
        dossierName: 'Dona Shop',
        title: 'Today filing',
        type: 'TAX',
        priority: 'NORMAL',
        status: 'PENDING',
        responsibleDisplayName: 'Chris',
        dueDate: '2026-07-26'
      },
      {
        deadlineId: 'deadline-3',
        dossierOrgId: 'org-client',
        dossierName: 'Eco Bank',
        title: 'Tomorrow filing',
        type: 'TAX',
        priority: 'NORMAL',
        status: 'PENDING',
        dueDate: '2026-07-27'
      }
    ]
  }
};

describe('CabinetDashboardPage', () => {
  let queryClient: QueryClient;
  let router: Router;
  let getCabinetDashboard: ReturnType<typeof vi.fn>;
  const activeCabinetRole = signal<CabinetRole | null>('CABINET_ADMIN');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    activeCabinetRole.set('CABINET_ADMIN');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getCabinetDashboard = vi.fn().mockResolvedValue(baseDashboard);

    await TestBed.configureTestingModule({
      imports: [
        CabinetDashboardPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: CabinetDashboardApi, useValue: { getCabinetDashboard } },
        {
          provide: AuthStore,
          useValue: {
            activeCabinetRole,
            activeWorkspaceOrgId: () => 'org-cabinet',
            activeWorkspaceType: () => 'ACCOUNTING_FIRM',
            currentUserId: () => 'user-1',
            dossiers: () => []
          }
        }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('renders CABINET dashboard metrics from exact backend totals, not bounded previews', async () => {
    const fixture = TestBed.createComponent(CabinetDashboardPage);
    fixture.detectChanges();
    await waitForText(fixture, '12 overdue work items');

    const text = compactText(fixture);
    expect(getCabinetDashboard).toHaveBeenCalledTimes(1);
    expect(text).toContain("Overview of the Cabinet's activity and priorities.");
    expect(text).toContain('Active dossiers');
    expect(text).toContain('20');
    expect(text).toContain('12 overdue work items');
    expect(text).toContain('4 overdue deadlines');
    expect(text).toContain('Review receivables');
    expect(text).toContain('Dona Shop');
    expect(text).toContain('Awa Mensah');
    expect(text).toContain('Today filing');
    expect(text).toContain('Today');
    expect(text).toContain('Tomorrow filing');
    expect(text).toContain('Tomorrow');
    expect(text).toContain('Active members');
    expect(text).toContain('8');
    expect(text).not.toContain('1 overdue work items');
    expect(text).not.toContain('CABINET');
  });

  it('uses personal scope copy and omits unauthorized creation actions', async () => {
    activeCabinetRole.set('COLLABORATOR');
    getCabinetDashboard.mockResolvedValue({
      ...baseDashboard,
      scope: 'PERSONAL_ACTIVITY',
      team: undefined,
      portfolio: { activeDossiers: 1, accessibleDossiers: 2 }
    } satisfies CabinetDashboardResponse);

    const fixture = TestBed.createComponent(CabinetDashboardPage);
    fixture.detectChanges();
    await waitForText(fixture, 'My active work');

    const text = compactText(fixture);
    expect(text).toContain('Track your work, deadlines, and attention items.');
    expect(text).toContain('My activity');
    expect(text).toContain('My overdue work');
    expect(text).toMatch(/Accessible dossiers\s*2/);
    expect(text).not.toContain('New work');
    expect(text).not.toContain('New deadline');
    expect(text).not.toContain('Active members');
    expect(text).not.toContain('PERSONAL_ACTIVITY');
  });

  it('keeps reader scope informational and navigates to cabinet modules only', async () => {
    activeCabinetRole.set('READER');
    getCabinetDashboard.mockResolvedValue({
      ...baseDashboard,
      scope: 'ASSIGNED_DOSSIERS_READ_ONLY',
      team: undefined,
      portfolio: { activeDossiers: 1, accessibleDossiers: 3 }
    } satisfies CabinetDashboardResponse);

    const fixture = TestBed.createComponent(CabinetDashboardPage);
    fixture.detectChanges();
    await waitForText(fixture, 'My accessible dossiers');

    const page = fixture.componentInstance as unknown as {
      openDeadlines(): void;
      openDossiers(): void;
      openWorks(): void;
    };
    page.openWorks();
    page.openDeadlines();
    page.openDossiers();

    const text = compactText(fixture);
    expect(text).toContain('Review accessible dossiers.');
    expect(text).toContain('Accessible dossiers');
    expect(text).toMatch(/Accessible dossiers\s*3/);
    expect(text).not.toContain('New work');
    expect(text).not.toContain('New deadline');
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/works']);
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/deadlines']);
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dossiers']);
  });
});

async function waitForText(
  fixture: ComponentFixture<CabinetDashboardPage>,
  expectedText: string
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    if (fixture.nativeElement.textContent.includes(expectedText)) {
      return;
    }
  }
  throw new Error(`Expected dashboard text was not rendered: ${expectedText}`);
}

function compactText(fixture: ComponentFixture<CabinetDashboardPage>): string {
  return fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
}
